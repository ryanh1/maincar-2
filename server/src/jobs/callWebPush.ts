import { sendWebPush } from '../../dependencies/webPush.js'
import prisma from '../db.js'
import { buildCallWebPushPayload, shouldDeliverCallWebPush, type CallWebPushEvent } from '../lib/callWebPush.js'
import { readCallAlertSettings } from '../routes/callAlertSettings.js'
import { JOB_DELIVER_CALL_WEB_PUSH, sendJob, workJob } from './queue.js'

export interface CallWebPushJob { userId: string; event: CallWebPushEvent; eventKey: string }

export async function queueCallWebPush(job: CallWebPushJob): Promise<void> {
  await sendJob(JOB_DELIVER_CALL_WEB_PUSH, job, { singletonKey: job.eventKey, retryLimit: 3 })
}

export async function deliverCallWebPush(job: CallWebPushJob): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: job.userId },
    select: { timeZone: true, callAlertSettings: true, webPushSubscriptions: true },
  })
  if (!user) return
  const settings = readCallAlertSettings(user.callAlertSettings)
  if (!shouldDeliverCallWebPush({ event: job.event, settings, timeZone: user.timeZone ?? 'UTC' })) return
  const payload = buildCallWebPushPayload(job)

  for (const subscription of user.webPushSubscriptions) {
    const claim = await prisma.webPushDelivery.createMany({
      data: { subscriptionId: subscription.id, eventKey: job.eventKey }, skipDuplicates: true,
    })
    if (claim.count === 0) continue
    try {
      await sendWebPush({ ...subscription, payload })
      await prisma.webPushDelivery.updateMany({
        where: { subscriptionId: subscription.id, eventKey: job.eventKey }, data: { deliveredAt: new Date() },
      })
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0
      if (statusCode === 404 || statusCode === 410) await prisma.webPushSubscription.deleteMany({ where: { id: subscription.id } })
      else await prisma.webPushDelivery.deleteMany({ where: { subscriptionId: subscription.id, eventKey: job.eventKey } })
      throw error
    }
  }
}

export async function registerCallWebPushWorker(): Promise<string> {
  return workJob<CallWebPushJob>(JOB_DELIVER_CALL_WEB_PUSH, { batchSize: 1 }, async (job) => deliverCallWebPush(job.data))
}
