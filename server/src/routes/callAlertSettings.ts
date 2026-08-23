import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const channelsSchema = z.object({
  sound: z.boolean(),
  popover: z.boolean(),
  browserNotification: z.boolean(),
  desktopNotification: z.boolean(),
}).strict()
const settingsSchema = z.object({
  incoming: channelsSchema,
  missed: channelsSchema,
  voicemail: channelsSchema,
  ringSound: z.enum(['classic', 'chime']),
  volume: z.number().min(0).max(1),
  doNotDisturb: z.object({
    enabled: z.boolean(),
    startTime: timeSchema,
    endTime: timeSchema,
  }).strict(),
}).strict()
const requestSchema = z.object({ callAlertSettings: settingsSchema }).strict()

export type CallAlertSettings = z.infer<typeof settingsSchema>

export const callAlertDefaults: CallAlertSettings = {
  incoming: { sound: true, popover: true, browserNotification: false, desktopNotification: false },
  missed: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
  voicemail: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
  ringSound: 'classic',
  volume: 0.8,
  doNotDisturb: { enabled: false, startTime: '18:00', endTime: '08:00' },
}

function readSettings(value: unknown): CallAlertSettings {
  const parsed = settingsSchema.safeParse(value)
  return parsed.success ? parsed.data : callAlertDefaults
}

router.get(
  '/',
  requireAuth,
  wrapRoute('GET /api/call-alert-settings', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    return void res.json({ callAlertSettings: readSettings(user.callAlertSettings) })
  }),
)

router.put(
  '/',
  requireAuth,
  wrapRoute('PUT /api/call-alert-settings', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    // --- Parse & validate params ---
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: 'Those alert settings are not valid' })

    // --- Execute query ---
    await prisma.user.update({
      where: { id: user.id },
      data: { callAlertSettings: parsed.data.callAlertSettings },
    })

    // --- Return response ---
    return void res.json({ callAlertSettings: parsed.data.callAlertSettings })
  }),
)

export default router
