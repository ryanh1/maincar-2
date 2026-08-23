import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import {
  notificationChannels,
  notificationDeliveryDefaults,
  type NotificationDeliverySettings,
} from '../lib/notificationDeliverySettings.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const channelSettingsSchema = z.object({
  timing: z.enum(['immediate', 'digest', 'off']),
  digestFrequency: z.enum(['hourly', 'daily']),
  digestTime: timeSchema,
}).strict()
const settingsSchema = z.object({
  channels: z.object({
    in_app: channelSettingsSchema,
    email: channelSettingsSchema,
    push: channelSettingsSchema,
    slack: channelSettingsSchema,
  }).strict(),
  quietHours: z.object({
    enabled: z.boolean(),
    startTime: timeSchema,
    endTime: timeSchema,
  }).strict(),
}).strict().superRefine((settings, context) => {
  if (settings.channels.in_app.timing !== 'immediate') {
    context.addIssue({ code: 'custom', message: 'In-app inbox notifications stay immediate.' })
  }
})
const requestSchema = z.object({ notificationDeliverySettings: settingsSchema }).strict()

export function readNotificationDeliverySettings(value: unknown): NotificationDeliverySettings {
  const parsed = settingsSchema.safeParse(value)
  return parsed.success ? parsed.data : notificationDeliveryDefaults
}

router.use(requireAuth)

router.get(
  '/',
  wrapRoute('GET /api/notification-delivery-settings', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    return void res.json({ notificationDeliverySettings: readNotificationDeliverySettings(user.notificationDeliverySettings) })
  }),
)

router.put(
  '/',
  wrapRoute('PUT /api/notification-delivery-settings', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    // --- Parse & validate params ---
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Execute query ---
    const notificationDeliverySettings = parsed.data.notificationDeliverySettings
    await prisma.user.update({ where: { id: user.id }, data: { notificationDeliverySettings } })

    // --- Return response ---
    return void res.json({ notificationDeliverySettings })
  }),
)

export { notificationChannels }
export default router
