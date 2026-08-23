import { google } from 'googleapis'
import { Router } from 'express'

import { PUBLIC_BASE_URL } from '../config.js'
import prisma from '../db.js'
import { queuePushMailSync } from '../jobs/mailPushSubscriptions.js'
import { wrapRoute } from '../lib/fnWrapper.js'

const router = Router()

function pushUrl(path: string): string {
  return `${PUBLIC_BASE_URL}${path}`
}

async function verifyGooglePush(req: import('express').Request): Promise<boolean> {
  const authorization = req.header('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  if (!token || !PUBLIC_BASE_URL) return false
  try {
    await new google.auth.OAuth2().verifyIdToken({ idToken: token, audience: pushUrl('/api/mail-push/google') })
    return true
  } catch {
    return false
  }
}

// Pub/Sub’s identity token is verified before reading its encoded data. Gmail only
// supplies an address/history marker; the queued incremental poll owns the actual
// cursor read and safely catches any missed notification on its five-minute floor.
router.post('/google', wrapRoute('POST /api/mail-push/google', async (req, res) => {
  if (!(await verifyGooglePush(req))) return void res.status(403).json({ error: 'Invalid Pub/Sub identity' })
  const encoded = (req.body as { message?: { data?: unknown } } | undefined)?.message?.data
  if (typeof encoded !== 'string') return void res.status(400).json({ error: 'Missing Pub/Sub message' })
  let emailAddress: string
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as { emailAddress?: unknown }
    if (typeof parsed.emailAddress !== 'string' || !parsed.emailAddress) throw new Error('missing address')
    emailAddress = parsed.emailAddress
  } catch {
    return void res.status(400).json({ error: 'Invalid Pub/Sub message' })
  }
  const accounts = await prisma.mailAccount.findMany({ where: { provider: 'google', emailAddress }, select: { id: true } })
  await Promise.all(accounts.map((account) => queuePushMailSync(account.id)))
  res.status(204).send()
}))

router.post('/google-calendar', wrapRoute('POST /api/mail-push/google-calendar', async (req, res) => {
  const remoteId = req.header('x-goog-channel-id')
  const verificationToken = req.header('x-goog-channel-token')
  if (!remoteId || !verificationToken) return void res.status(403).json({ error: 'Invalid Google Calendar notification' })
  const subscription = await prisma.mailPushSubscription.findFirst({
    where: { remoteId, verificationToken, kind: 'google_calendar' }, select: { mailAccountId: true },
  })
  if (!subscription) return void res.status(403).json({ error: 'Invalid Google Calendar notification' })
  await queuePushMailSync(subscription.mailAccountId)
  res.status(204).send()
}))

// Graph’s endpoint-validation probe must echo the token as plain text before any
// callback authentication. Normal change notifications authenticate per-item with
// the random clientState stored beside the opaque subscription id.
router.post('/microsoft', wrapRoute('POST /api/mail-push/microsoft', async (req, res) => {
  const validationToken = typeof req.query.validationToken === 'string' ? req.query.validationToken : null
  if (validationToken) return void res.status(200).type('text/plain').send(validationToken)
  const notifications = (req.body as { value?: unknown } | undefined)?.value
  if (!Array.isArray(notifications)) return void res.status(400).json({ error: 'Invalid Graph notification' })
  for (const notification of notifications) {
    if (!notification || typeof notification !== 'object') continue
    const { subscriptionId, clientState } = notification as { subscriptionId?: unknown; clientState?: unknown }
    if (typeof subscriptionId !== 'string' || typeof clientState !== 'string') continue
    const subscription = await prisma.mailPushSubscription.findFirst({
      where: { remoteId: subscriptionId, verificationToken: clientState }, select: { mailAccountId: true },
    })
    if (subscription) await queuePushMailSync(subscription.mailAccountId)
  }
  res.status(202).send()
}))

export default router
