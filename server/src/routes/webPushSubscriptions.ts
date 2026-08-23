import { Router } from 'express'
import { z } from 'zod'

import { WEB_PUSH_VAPID_PUBLIC_KEY } from '../config.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2_048),
  keys: z.object({
    auth: z.string().min(1).max(512),
    p256dh: z.string().min(1).max(512),
  }).strict(),
}).strict()
const revokeSchema = z.object({ endpoint: z.string().url().max(2_048) }).strict()

router.get(
  '/vapid-key',
  requireAuth,
  wrapRoute('GET /api/web-push/vapid-key', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })
    if (!WEB_PUSH_VAPID_PUBLIC_KEY) return void res.status(503).json({ error: 'Background browser alerts are not configured' })

    return void res.json({ webPushVapidPublicKey: WEB_PUSH_VAPID_PUBLIC_KEY })
  }),
)

router.put(
  '/subscriptions',
  requireAuth,
  wrapRoute('PUT /api/web-push/subscriptions', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    // --- Parse & validate params ---
    const parsed = subscriptionSchema.safeParse(req.body?.subscription)
    if (!parsed.success) return void res.status(400).json({ error: 'That browser subscription is not valid' })

    // --- Verify ownership ---
    const existing = await prisma.webPushSubscription.findUnique({ where: { endpoint: parsed.data.endpoint } })
    if (existing && existing.userId !== user.id) {
      return void res.status(409).json({ error: 'That browser is connected to another Maincar account' })
    }

    // --- Execute query ---
    if (existing) {
      await prisma.webPushSubscription.update({
        where: { endpoint: existing.endpoint },
        data: { p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
      })
    } else {
      await prisma.webPushSubscription.create({
        data: {
          userId: user.id,
          endpoint: parsed.data.endpoint,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
        },
      })
    }

    // --- Return response ---
    return void res.json({ webPushSubscription: { endpoint: parsed.data.endpoint } })
  }),
)

router.delete(
  '/subscriptions',
  requireAuth,
  wrapRoute('DELETE /api/web-push/subscriptions', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    // --- Parse & validate params ---
    const parsed = revokeSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: 'That browser subscription is not valid' })

    // --- Execute query ---
    await prisma.webPushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: user.id } })

    // --- Return response ---
    return void res.status(204).send()
  }),
)

export default router
