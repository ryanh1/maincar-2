import type { Prisma } from '../generated/prisma/client.js'

export interface EnsureOneDefaultOptions {
  /** Explicitly make this existing drop the organization's default. */
  defaultId?: string
  /** Use this new drop only when the organization has no default yet. */
  fallbackDefaultId?: string
}

/**
 * Locks an organization's full drop library before a mutation makes a decision
 * from its contents. Every default-changing path must take this same lock.
 */
export async function lockVoicemailDrops(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM "VoicemailDrop"
      WHERE "orgId" = ${orgId}
      FOR UPDATE
    ) AS locked
  `
  return Number(rows[0]?.count ?? 0)
}

/**
 * Leaves an organization's non-empty library with exactly one default. Call
 * this inside the same transaction as the create, default change, or delete.
 */
export async function ensureOneDefault(
  tx: Prisma.TransactionClient,
  orgId: string,
  { defaultId, fallbackDefaultId }: EnsureOneDefaultOptions = {},
): Promise<string | null> {
  const dropCount = await lockVoicemailDrops(tx, orgId)
  if (dropCount === 0) return null

  if (defaultId) {
    const requestedDrop = await tx.voicemailDrop.findFirst({ where: { id: defaultId, orgId } })
    if (!requestedDrop) throw new Error('Requested voicemail drop is missing')

    await tx.voicemailDrop.updateMany({
      where: { orgId, isDefault: true, id: { not: defaultId } },
      data: { isDefault: false },
    })
    const promoted = await tx.voicemailDrop.updateMany({
      where: { id: defaultId, orgId },
      data: { isDefault: true },
    })
    if (promoted.count !== 1) throw new Error('Requested voicemail drop could not become default')
    return defaultId
  }

  const currentDefault = await tx.voicemailDrop.findFirst({ where: { orgId, isDefault: true } })
  if (currentDefault) return currentDefault.id

  const fallbackDrop = fallbackDefaultId
    ? await tx.voicemailDrop.findFirst({ where: { id: fallbackDefaultId, orgId } })
    : null
  const replacement = fallbackDrop ?? await tx.voicemailDrop.findFirst({
    where: { orgId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (!replacement) throw new Error('Voicemail drop replacement missing after library lock')

  const promoted = await tx.voicemailDrop.updateMany({
    where: { id: replacement.id, orgId },
    data: { isDefault: true },
  })
  if (promoted.count !== 1) throw new Error('Voicemail drop replacement could not become default')
  return replacement.id
}
