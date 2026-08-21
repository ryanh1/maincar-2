/**
 * workLinks — how a Task or a Note attaches to the records it is about
 * (MAI-141 T13; spec §5.4, §6).
 *
 * THE SEAM IS `RecordLink`, AND THERE IS NO SECOND ONE. T7 added nullable
 * `noteId`/`taskId` columns to that table as exactly this hook, and this module is
 * the only writer of them. A dedicated NoteLink/TaskLink table would have been a
 * second answer to "what is attached to this record", and a record page that has
 * to ask two tables is a record page that will one day show one and miss the
 * other.
 *
 * Every row this module writes fills BOTH halves of the seam:
 *   - `fromObject` + `fromId` — the generic edge, the same shape a custom object's
 *     reference field writes, so ONE query answers "everything pointing at this
 *     record" whatever kind of thing is pointing;
 *   - `noteId` / `taskId` — the real foreign key, so deleting a note takes its
 *     edges with it (Cascade) instead of leaving links pointing at nothing.
 * Writing one without the other is the bug this module exists to make impossible.
 *
 * `attribute` stays NULL. It names the AttributeDef slug a reference field came
 * from, and a note/task attachment did not come from a field.
 */
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { isSpineLinkObject, type LinkTarget } from './taskNote.js'

/** Reads may run on the singleton or inside a transaction; writes take the tx. */
type ReadClient = PrismaClient | Prisma.TransactionClient

/** Which kind of work row owns the links. `RecordLink.fromObject`. */
export type WorkLinkSource = 'note' | 'task'

/**
 * How many records one note or task may be attached to.
 *
 * A note linking to many records is the T13 acceptance criterion, so there is no
 * small ceiling here — but there is a ceiling, because "attach this note to every
 * person in the org" is one request that would write an unbounded number of rows
 * inside one transaction. 50 is far past any real note (the widest in practice is
 * a meeting recap touching an account, a deal, and the six people in the room) and
 * still small enough to be a single fast write.
 */
export const MAX_LINKS_PER_WORK_ITEM = 50

/**
 * De-duplicates the targets a caller sent, preserving order.
 *
 * The same record named twice is one attachment, not two: a note attached twice to
 * Acme renders twice on Acme's page and un-attaches only half-way when a rep
 * removes it. Silently collapsing beats 400-ing, because the duplicate is almost
 * always a UI that appended a chip the user had already picked.
 */
export function dedupeLinkTargets(targets: LinkTarget[]): LinkTarget[] {
  const seen = new Set<string>()
  const out: LinkTarget[] = []
  for (const target of targets) {
    // An explicit \u0000 escape, not a raw NUL byte and not a space: the separator
    // must be a character neither an object slug nor an id can contain, and writing
    // it as an escape keeps THIS file plain text (a raw NUL makes git treat the
    // source as binary and stop diffing it).
    const key = `${target.object}\u0000${target.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

/**
 * Verifies every target exists IN THIS ORG, and returns an error string for the
 * first one that does not (or null when they all do).
 *
 * This is the closest a generic edge table gets to a foreign key, and it is what
 * stops a note being attached to another tenant's company: the org filter is in
 * every lookup, so a real id from another org resolves to nothing and is answered
 * exactly like an id that never existed. It also stops a note attaching to a
 * TRASHED record, which would resurrect it on a page nobody expected.
 *
 * Two kinds of target, checked two ways:
 *   - `person` / `company` / `deal` — the table-backed spine, verified against its
 *     own table;
 *   - anything else — read as a custom ObjectDef slug in this org, and verified
 *     against the Record row it names. A slug this org has never defined is a 422,
 *     not a silently-written dangling edge.
 */
export async function verifyLinkTargets(
  db: ReadClient,
  orgId: string,
  targets: LinkTarget[],
): Promise<string | null> {
  for (const target of targets) {
    if (target.object === 'person') {
      const row = await db.person.findFirst({
        where: { id: target.id, orgId, deletedAt: null },
        select: { id: true },
      })
      if (!row) return `No person with id ${target.id} in this org.`
      continue
    }
    if (target.object === 'company') {
      const row = await db.company.findFirst({
        where: { id: target.id, orgId, deletedAt: null },
        select: { id: true },
      })
      if (!row) return `No company with id ${target.id} in this org.`
      continue
    }
    if (target.object === 'deal') {
      const row = await db.deal.findFirst({
        where: { id: target.id, orgId, deletedAt: null },
        select: { id: true },
      })
      if (!row) return `No deal with id ${target.id} in this org.`
      continue
    }

    // A custom object. Its rows live in Record, keyed by the ObjectDef's id.
    const object = await db.objectDef.findFirst({
      where: { orgId, slug: target.object, deletedAt: null },
      select: { id: true, storage: true },
    })
    if (!object) return `This org has no object called "${target.object}".`
    if (object.storage !== 'record') {
      return `Links to "${target.object}" are not supported.`
    }
    const row = await db.record.findFirst({
      where: { id: target.id, orgId, objectId: object.id, deletedAt: null },
      select: { id: true },
    })
    if (!row) return `No ${target.object} with id ${target.id} in this org.`
  }
  return null
}

/**
 * Rewrites a note's or task's attachments to exactly `targets`, inside the
 * caller's transaction.
 *
 * Delete-then-insert rather than a diff, deliberately: the set is small (see
 * `MAX_LINKS_PER_WORK_ITEM`), the whole set arrives on every PATCH, and a diff
 * would be a second implementation of "what changed" whose bugs are invisible
 * until a link goes missing. The delete is keyed on `noteId`/`taskId` — the real
 * foreign key — so it can never reach a link belonging to a different note that
 * happens to share a `fromId`.
 *
 * Takes a transaction client so links and the row they belong to commit together:
 * a note that saved without its attachments is a note nobody will ever find again.
 */
export async function syncWorkLinks(
  tx: Prisma.TransactionClient,
  args: { orgId: string; source: WorkLinkSource; sourceId: string; targets: LinkTarget[] },
): Promise<void> {
  const { orgId, source, sourceId, targets } = args
  const key = source === 'note' ? { noteId: sourceId } : { taskId: sourceId }

  await tx.recordLink.deleteMany({ where: { orgId, ...key } })
  if (targets.length === 0) return

  await tx.recordLink.createMany({
    data: targets.map((target) => ({
      orgId,
      // Both halves of the seam, always. See the module header.
      fromObject: source,
      fromId: sourceId,
      attribute: null,
      toObject: target.object,
      toId: target.id,
      ...key,
    })),
  })
}

/**
 * Reads back a note's or task's attachments, newest-written last so the order a
 * client renders is the order they were attached.
 */
export async function loadWorkLinks(
  db: ReadClient,
  args: { orgId: string; source: WorkLinkSource; sourceId: string },
): Promise<{ toObject: string; toId: string }[]> {
  const key = args.source === 'note' ? { noteId: args.sourceId } : { taskId: args.sourceId }
  return db.recordLink.findMany({
    where: { orgId: args.orgId, ...key },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { toObject: true, toId: true },
  })
}

/**
 * The ids of the notes/tasks attached to one record — the "show me the notes on
 * this company" filter, run as a subquery over the same index.
 *
 * Returns ids rather than rows so the caller's own paginated, org-scoped query
 * stays the one that reads the table. `null` is never returned: a record with no
 * attachments yields an empty array, which the caller turns into an empty page
 * rather than an unfiltered one.
 */
export async function idsLinkedToRecord(
  db: ReadClient,
  args: { orgId: string; source: WorkLinkSource; target: LinkTarget },
): Promise<string[]> {
  const { orgId, source, target } = args
  const links = await db.recordLink.findMany({
    where: {
      orgId,
      fromObject: source,
      toObject: target.object,
      toId: target.id,
      ...(source === 'note' ? { noteId: { not: null } } : { taskId: { not: null } }),
    },
    select: { noteId: true, taskId: true },
  })
  const ids = links.map((link) => (source === 'note' ? link.noteId : link.taskId))
  return [...new Set(ids.filter((id): id is string => id !== null))]
}

/**
 * Re-exported so a route can ask "is this one of the spine objects" without
 * importing two modules to write one link.
 */
export { isSpineLinkObject }
