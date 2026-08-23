import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const eventKinds = ['mention', 'assignment', 'comment', 'status_change', 'team_broadcast'] as const
const channels = ['in_app', 'email', 'push', 'slack'] as const
const defaultEnabledEventKinds = new Set(['mention', 'assignment'])

const preferenceSchema = z.object({
  eventKind: z.enum(eventKinds),
  channel: z.enum(channels),
  enabled: z.boolean(),
}).strict()

const requestSchema = z.object({
  notificationPreferences: z.array(preferenceSchema).length(eventKinds.length * channels.length),
}).strict().superRefine(({ notificationPreferences }, context) => {
  const preferenceKeys = new Set(notificationPreferences.map(({ eventKind, channel }) => `${eventKind}:${channel}`))
  if (preferenceKeys.size !== notificationPreferences.length) {
    context.addIssue({ code: 'custom', message: 'Each notification channel can be set once.' })
  }

  for (const eventKind of eventKinds) {
    for (const channel of channels) {
      if (!preferenceKeys.has(`${eventKind}:${channel}`)) {
        context.addIssue({ code: 'custom', message: 'Every notification channel must be included.' })
        return
      }
    }
  }

  if (notificationPreferences.some(({ channel, enabled }) => channel === 'in_app' && !enabled)) {
    context.addIssue({ code: 'custom', message: 'In-app inbox notifications stay on.' })
  }
})

export type NotificationPreference = z.infer<typeof preferenceSchema>

export function notificationPreferenceDefaults(): NotificationPreference[] {
  return eventKinds.flatMap((eventKind) => channels.map((channel) => ({
    eventKind,
    channel,
    enabled: channel === 'in_app' || defaultEnabledEventKinds.has(eventKind),
  })))
}

function mergePreferences(
  saved: Array<{ eventKind: string; channel: string; enabled: boolean }>,
): NotificationPreference[] {
  const savedByKey = new Map(saved.map((preference) => [`${preference.eventKind}:${preference.channel}`, preference.enabled]))
  return notificationPreferenceDefaults().map((preference) => ({
    ...preference,
    enabled: preference.channel === 'in_app'
      ? true
      : savedByKey.get(`${preference.eventKind}:${preference.channel}`) ?? preference.enabled,
  }))
}

router.use(requireAuth)

// GET /api/notification-preferences
router.get(
  '/',
  wrapRoute('GET /api/notification-preferences', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    // --- Execute query ---
    const saved = await prisma.notificationPreference.findMany({
      where: { userId: user.id },
      select: { eventKind: true, channel: true, enabled: true },
    })

    // --- Return response ---
    return void res.json({ notificationPreferences: mergePreferences(saved) })
  }),
)

// PUT /api/notification-preferences
router.put(
  '/',
  wrapRoute('PUT /api/notification-preferences', async (req, res) => {
    const { user } = req as AuthenticatedRequest
    if (!user) return void res.status(401).json({ error: 'Not signed in' })

    // --- Parse & validate params ---
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Execute query ---
    const notificationPreferences = parsed.data.notificationPreferences
    await prisma.$transaction(notificationPreferences.map((preference) => prisma.notificationPreference.upsert({
      where: {
        userId_eventKind_channel: {
          userId: user.id,
          eventKind: preference.eventKind,
          channel: preference.channel,
        },
      },
      create: { userId: user.id, ...preference },
      update: { enabled: preference.enabled },
    })))

    // --- Return response ---
    return void res.json({ notificationPreferences })
  }),
)

export default router
