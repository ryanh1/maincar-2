import prisma from '../db.js'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { evaluateCaptureExclusions, type CaptureSettings } from '../lib/captureExclusions.js'
import { JOB_CAPTURE_PURGE, workJob } from './queue.js'

type Db = Pick<PrismaClient, '$transaction'>
type Tx = Prisma.TransactionClient

export type CapturePurgePayload = {
  orgId: string
  /** A stable settings-version key; retries of this job reuse the same key. */
  ruleId: string
  actorId: string
  /** Immutable policy snapshot from the save that introduced the exclusion. */
  settings: CaptureSettings
}

export type CapturePurgeResult = { emails: number; meetings: number }

async function removeActivityLinks(tx: Tx, orgId: string, sourceType: 'email' | 'meeting', sourceId: string): Promise<void> {
  const links = await tx.activityLink.findMany({
    where: { orgId, sourceType, sourceId },
    select: { targetType: true, targetId: true },
  })

  await tx.activityEntry.deleteMany({ where: { orgId, sourceType, sourceId } })
  await tx.activityLink.deleteMany({ where: { orgId, sourceType, sourceId } })

  await Promise.all(
    links.map(async (link) => {
      const where = { orgId, id: link.targetId }
      const data = { activityCount: { decrement: 1 } }
      if (link.targetType === 'person') {
        const latest = await tx.activityEntry.findFirst({
          where: { orgId, personId: link.targetId },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        })
        return tx.person.updateMany({
          where,
          data: { ...data, lastContactedAt: latest?.occurredAt ?? null },
        })
      }
      if (link.targetType === 'company') return tx.company.updateMany({ where, data })
      return tx.deal.updateMany({ where, data })
    }),
  )
}

/**
 * Soft-delete all active stored capture activity that the latest exclusion policy
 * rejects. The `deletedAt: null` compare-and-set makes every source activity safe
 * under pg-boss's at-least-once delivery; a retry cannot delete it twice or
 * decrement its derived counts again.
 */
export async function capturePurgeJob(payload: CapturePurgePayload, db: Db = prisma): Promise<CapturePurgeResult> {
  const policy = payload.settings
  return db.$transaction(async (tx) => {
    const [emails, meetings] = await Promise.all([
      tx.email.findMany({
        where: { orgId: payload.orgId, deletedAt: null },
        select: {
          id: true,
          subject: true,
          direction: true,
          participants: { select: { address: true } },
        },
      }),
      tx.meeting.findMany({
        where: { orgId: payload.orgId, deletedAt: null },
        select: {
          id: true,
          title: true,
          organizerEmail: true,
          attendees: { select: { email: true } },
        },
      }),
    ])

    let purgedEmails = 0
    for (const email of emails) {
      const excluded = evaluateCaptureExclusions(policy, {
        participants: email.participants.map((participant) => ({ address: participant.address })),
        subject: email.subject,
        direction: email.direction === 'outbound' ? 'outbound' : 'inbound',
        activityType: 'email',
      }).excluded
      if (!excluded) continue

      const deleted = await tx.email.updateMany({
        where: { id: email.id, orgId: payload.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      if (deleted.count === 0) continue
      await removeActivityLinks(tx, payload.orgId, 'email', email.id)
      purgedEmails += 1
    }

    let purgedMeetings = 0
    for (const meeting of meetings) {
      const participants = [
        ...meeting.attendees.map((attendee) => ({ address: attendee.email })),
        ...(meeting.organizerEmail ? [{ address: meeting.organizerEmail }] : []),
      ]
      const excluded = evaluateCaptureExclusions(policy, {
        participants,
        subject: meeting.title,
        activityType: 'meeting',
      }).excluded
      if (!excluded) continue

      const deleted = await tx.meeting.updateMany({
        where: { id: meeting.id, orgId: payload.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      if (deleted.count === 0) continue
      await removeActivityLinks(tx, payload.orgId, 'meeting', meeting.id)
      purgedMeetings += 1
    }

    const result = { emails: purgedEmails, meetings: purgedMeetings }
    await tx.auditLog.upsert({
      where: { orgId_batchId: { orgId: payload.orgId, batchId: payload.ruleId } },
      create: {
        orgId: payload.orgId,
        actorId: payload.actorId,
        action: 'capture_purge',
        objectType: 'capture_settings',
        objectId: payload.ruleId,
        batchId: payload.ruleId,
        diffJson: result,
      },
      update: { diffJson: result },
    })
    return result
  })
}

/** Register the single-item worker; pg-boss retries transient failures three times. */
export async function registerCapturePurgeWorker(): Promise<string> {
  return workJob<CapturePurgePayload>(JOB_CAPTURE_PURGE, { batchSize: 1 }, async (job) => {
    await capturePurgeJob(job.data)
  })
}
