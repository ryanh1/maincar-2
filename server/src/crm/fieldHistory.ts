/**
 * fieldHistory — the ONE place a field change is written to history (MAI-136 T8,
 * spec §5.7, plan T8).
 *
 * Two rules the rest of the app depends on:
 *
 *   1. HISTORY IS ATOMIC WITH THE CHANGE. `recordFieldHistoryInTx` only takes a
 *      transaction client, never the base PrismaClient, so a history row cannot be
 *      written outside the transaction that made the change. Both commit or both
 *      roll back; a value and its history can never disagree.
 *   2. HISTORY IS NEVER THE SOURCE OF TRUTH. It is append-only. "What is the
 *      current value" stays a plain column read (§5.7) — nothing here is replayed
 *      to reconstruct a value.
 *
 * A non-human change records `changeSource` (enrichment | ai | import | workflow |
 * system) with `changedByUserId = null`: only a `user` change carries a user id,
 * and that is enforced here rather than left to each caller.
 *
 * `oldJson`/`newJson` are schemaless, so their shape is validated in app code
 * against the attribute's declared type (§5.7) — through the same checks the normal
 * field-write validator uses (./valuesValidator.ts). The database will not do it.
 */
import { Prisma } from '../generated/prisma/client.js'

import { checkValueShape, type ValidatorAttribute } from './valuesValidator.js'

// A client that can write the history rows. Prisma.TransactionClient — and ONLY
// that — so calling this outside a transaction is a type error, not a review catch.
export type HistoryClient = Prisma.TransactionClient

// Who or what made a change (spec §5.7). The DB column is a String (house rule: no
// Prisma enums); this union is the type-safe half of that pair.
export const CHANGE_SOURCES = [
  'user',
  'enrichment',
  'ai',
  'import',
  'workflow',
  'system',
] as const

export type ChangeSource = (typeof CHANGE_SOURCES)[number]

export function isChangeSource(value: unknown): value is ChangeSource {
  return typeof value === 'string' && (CHANGE_SOURCES as readonly string[]).includes(value)
}

/** One field that changed: the attribute slug plus what it went from and to. */
export interface FieldChange {
  attribute: string
  oldValue: unknown
  newValue: unknown
}

// --- JSON normalization -------------------------------------------------------
// The column is JSONB, so a Date or a BigInt (Deal.amountMinor) has to become
// something JSON can hold before it is compared or stored. `undefined` becomes null:
// "the field had no value" and "the key was absent" are the same thing in history.

export function toHistoryJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((v) => toHistoryJson(v)) as Prisma.InputJsonValue
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toHistoryJson(v)
    }
    return out as Prisma.InputJsonValue
  }
  return value as Prisma.InputJsonValue
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((el, i) => deepEqual(el, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) => k in bo && deepEqual(ao[k], bo[k]))
}

/**
 * The changed fields between two value bags, as history rows would see them.
 *
 * Two modes, because the two callers mean different things by "a key is missing":
 *
 *   - `patch` (default) — `after` holds only the keys the caller sent, so an absent
 *     key means "unchanged" and is skipped. A key present and null/empty means
 *     "cleared" and IS a change. This is a column PATCH (Person, Company, Deal).
 *   - `full` — `after` is the WHOLE post-write bag (Record.valuesJson, where a
 *     cleared key is stored absent, §5.14), so the diff walks the union of both
 *     sides and a key that vanished is a change to null.
 *
 * Values equal after JSON normalization produce no row: re-saving a form without
 * touching anything writes no history. `only` narrows the diff to a known set of
 * attribute slugs, so bookkeeping columns can never leak into a user-facing history.
 */
export function diffFieldValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  opts: { only?: readonly string[]; mode?: 'patch' | 'full' } = {},
): FieldChange[] {
  const allowed = opts.only ? new Set(opts.only) : null
  const keys =
    opts.mode === 'full'
      ? [...new Set([...Object.keys(before), ...Object.keys(after)])]
      : Object.keys(after)

  const changes: FieldChange[] = []
  for (const attribute of keys) {
    if (allowed && !allowed.has(attribute)) continue
    const oldValue = toHistoryJson(before[attribute])
    const newValue = toHistoryJson(after[attribute])
    if (deepEqual(oldValue, newValue)) continue
    changes.push({ attribute, oldValue, newValue })
  }
  return changes
}

// --- Shape validation ---------------------------------------------------------

/** Thrown when a history value does not match its attribute's declared type. */
export class FieldHistoryShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FieldHistoryShapeError'
  }
}

/**
 * Validates every change against its attribute's declared type (§5.7).
 *
 * An attribute the caller did not supply a definition for is left alone rather than
 * rejected: an org seeded before a field existed (seedVersion behind) still has real
 * column values, and history must never block a legitimate write. Definitions that
 * ARE supplied are enforced.
 */
export function validateChangeShapes(
  changes: readonly FieldChange[],
  attributes: readonly ValidatorAttribute[],
): void {
  if (attributes.length === 0) return
  const bySlug = new Map(attributes.map((a) => [a.slug, a]))
  for (const change of changes) {
    const attr = bySlug.get(change.attribute)
    if (!attr) continue
    for (const value of [change.oldValue, change.newValue]) {
      const error = checkValueShape(attr, value)
      if (error) {
        throw new FieldHistoryShapeError(
          `Cannot record history for ${change.attribute}: ${error}`,
        )
      }
    }
  }
}

// --- The write ----------------------------------------------------------------

export interface RecordFieldHistoryArgs {
  orgId: string
  // The object slug the record belongs to: person | company | deal | <custom>.
  objectSlug: string
  recordId: string
  changes: readonly FieldChange[]
  // Defaults to "user" — the overwhelmingly common case, and the only one that
  // carries a user id.
  changeSource?: ChangeSource
  // Ignored (stored NULL) for every source other than "user".
  changedByUserId?: string | null
  reason?: string | null
  // The attribute definitions for shape validation. Pass the ones already loaded by
  // the caller; an empty list skips validation.
  attributes?: readonly ValidatorAttribute[]
}

/**
 * Writes one FieldHistory row per changed field, inside the caller's transaction.
 *
 * Returns how many rows were written, so a caller can assert "the change and its
 * history landed together". Writing nothing for an empty change list is deliberate:
 * a no-op save leaves no history.
 */
export async function recordFieldHistoryInTx(
  tx: HistoryClient,
  args: RecordFieldHistoryArgs,
): Promise<number> {
  const {
    orgId,
    objectSlug,
    recordId,
    changes,
    changeSource = 'user',
    changedByUserId = null,
    reason = null,
    attributes = [],
  } = args

  if (changes.length === 0) return 0

  validateChangeShapes(changes, attributes)

  // Only a human edit names a human. A system/enrichment/AI/import/workflow change
  // stores NULL, and changeSource is what identifies the actor (§5.7).
  const userId = changeSource === 'user' ? (changedByUserId ?? null) : null

  const result = await tx.fieldHistory.createMany({
    data: changes.map((change) => ({
      orgId,
      objectSlug,
      recordId,
      attribute: change.attribute,
      oldJson: toHistoryJson(change.oldValue) ?? Prisma.DbNull,
      newJson: toHistoryJson(change.newValue) ?? Prisma.DbNull,
      changedByUserId: userId,
      changeSource,
      reason: reason ?? null,
    })),
  })
  return result.count
}

/**
 * The attribute definitions for one object, shaped for the validator.
 *
 * Read inside the caller's transaction so the definitions a change is validated
 * against are the ones in force at the moment of the write. Org-scoped on both the
 * object and the attribute lookup.
 */
export async function loadHistoryAttributes(
  tx: HistoryClient,
  orgId: string,
  objectSlug: string,
): Promise<ValidatorAttribute[]> {
  const object = await tx.objectDef.findFirst({
    where: { orgId, slug: objectSlug },
    select: { id: true },
  })
  if (!object) return []
  const attributes = await tx.attributeDef.findMany({
    where: { orgId, objectId: object.id, isArchived: false, deletedAt: null },
    select: {
      slug: true,
      name: true,
      type: true,
      isMulti: true,
      optionsJson: true,
    },
  })
  return attributes.map((a) => ({
    slug: a.slug,
    name: a.name,
    type: a.type,
    isMulti: a.isMulti,
    optionsJson: a.optionsJson ?? undefined,
  }))
}
