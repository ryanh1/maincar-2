import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'

const router = Router()

// This registry is deliberately server-owned too. A destructive action must be
// protected where a modified browser client cannot bypass its flag.
const KEYBOARD_ACTION_REGISTRY = {
  'delete-record': { destructive: true },
  'delete-company': { destructive: true },
  'delete-person': { destructive: true },
  'delete-deal': { destructive: true },
  'delete-call': { destructive: true },
  'delete-email-template': { destructive: true },
  'delete-email-signature': { destructive: true },
  'archive-team': { destructive: true },
} as const

function normalizeKeys(value: string): string | null {
  const parts = value
    .trim()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return null

  const rawKey = parts.at(-1)!
  if (!/^[a-z0-9?]$/i.test(rawKey)) return null
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()))
  const ordered = [
    ['cmd', 'Cmd'],
    ['ctrl', 'Ctrl'],
    ['alt', 'Alt'],
    ['shift', 'Shift'],
  ] as const
  if (modifiers.size !== parts.length - 1 || [...modifiers].some((modifier) => !ordered.some(([name]) => name === modifier))) return null

  return [...ordered.filter(([name]) => modifiers.has(name)).map(([, label]) => label), rawKey.toUpperCase()].join('+')
}

const updateBindingSchema = z
  .object({ keys: z.string().trim().max(32) })
  .strict()
  .transform((value, ctx) => {
    const keys = normalizeKeys(value.keys)
    if (!keys) {
      ctx.addIssue({ code: 'custom', message: 'Use a letter or modifier combination.' })
      return z.NEVER
    }
    return { keys }
  })

router.use(requireAuth)

router.get(
  '/',
  wrapRoute('GET /api/keyboard-bindings', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const bindings = await prisma.keyboardBinding.findMany({
      where: { userId: authReq.user!.id },
      select: { actionId: true, keys: true },
      orderBy: { actionId: 'asc' },
    })

    return void res.json({ bindings })
  }),
)

router.put(
  '/:actionId',
  wrapRoute('PUT /api/keyboard-bindings/:actionId', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const actionId = String(req.params.actionId)
    const parsed = updateBindingSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    if (KEYBOARD_ACTION_REGISTRY[actionId as keyof typeof KEYBOARD_ACTION_REGISTRY]?.destructive && !parsed.data.keys.includes('+')) {
      return void res.status(400).json({ error: 'Use a modifier key for destructive actions.' })
    }

    const binding = await prisma.keyboardBinding.upsert({
      where: { userId_actionId: { userId: authReq.user!.id, actionId } },
      create: { userId: authReq.user!.id, actionId, keys: parsed.data.keys },
      update: { keys: parsed.data.keys },
      select: { actionId: true, keys: true },
    })

    return void res.json({ binding })
  }),
)

export default router
