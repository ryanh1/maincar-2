/**
 * taskNote — the type-safe half of the Task/Note string columns, the ONE place a
 * TipTap document is flattened to searchable text, and the row → API mappers the
 * task and note routes use (MAI-141 T13; spec §6, impacts §J).
 *
 * The same pairing emailActivity.ts, smsActivity.ts, and meetingActivity.ts use,
 * for the same reason: the database columns are plain `String`s, because a
 * Postgres enum needs an ALTER TYPE dance to gain a value and these lists WILL
 * gain values (.claude/rules/database-and-prisma.md → No Enums). The unions below
 * are the other half — the allowed values written once, next to the guard that
 * narrows an unknown string to them.
 *
 * Three rules this module carries that the database cannot:
 *
 *   1. `Note.bodyText` IS DERIVED, NEVER SUPPLIED. `flattenTipTapText` is the one
 *      function that turns a TipTap document into the text stored beside it, and
 *      the routes call it on every write. A client that could POST its own
 *      `bodyText` could make a note that renders one thing and is findable as
 *      another, and nobody would ever see the disagreement — search would just
 *      quietly return the wrong notes.
 *   2. A LINK NAMES ITS TARGET BY OBJECT SLUG. `person`, `company`, `deal`, or a
 *      custom object's slug — the same vocabulary `RecordLink.toObject` already
 *      speaks, so a note's attachments and a custom object's references are read
 *      by one query against one table.
 *   3. `orgId` NEVER LEAVES THE SERVER in a mapped shape. It is the tenant
 *      boundary and the caller already knows it — it is in the path they asked on.
 */
import type { Note, RecordLink, Task } from '../generated/prisma/client.js'

// --- The string unions -------------------------------------------------------

/**
 * What KIND of thing the task is. `Task.type`.
 *
 * It is not a category for filing: it is what the "do it" button on a task card
 * turns into — a dialer for `call`, a composer for `email`, a checkbox for
 * `todo`. That is why it is a small closed list and not free text.
 */
export const TASK_TYPES = ['call', 'email', 'todo'] as const
export type TaskType = (typeof TASK_TYPES)[number]

/** How urgent it is. `Task.priority`. */
export const TASK_PRIORITIES = ['low', 'med', 'high'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/**
 * How hard the time on it is. `Task.commitment`.
 *
 * `hard` is an appointment — a slot somebody ELSE is holding open, so moving it
 * costs them. `soft` is a reminder — a slot only this rep is holding, so moving
 * it costs nobody. Deliberately NOT folded into `priority`: a low-priority
 * appointment is still an appointment.
 */
export const TASK_COMMITMENTS = ['hard', 'soft'] as const
export type TaskCommitment = (typeof TASK_COMMITMENTS)[number]

/**
 * Where the task CAME FROM. `Task.origin`. The T13 acceptance criterion.
 *
 * `calendar` means a sync derived this task from an event, and a later re-sync
 * may rewrite or retire it. `manual` means a person typed it, and no sync may
 * ever touch it. Losing that distinction means a calendar refresh silently
 * deleting work somebody committed to by hand, which is why it is a stored column
 * and not inferred from `eventId != null` — an event id can be attached to a
 * hand-made task too, when a rep links one to a meeting.
 */
export const TASK_ORIGINS = ['manual', 'calendar'] as const
export type TaskOrigin = (typeof TASK_ORIGINS)[number]

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value)
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value)
}

export function isTaskCommitment(value: unknown): value is TaskCommitment {
  return typeof value === 'string' && (TASK_COMMITMENTS as readonly string[]).includes(value)
}

export function isTaskOrigin(value: unknown): value is TaskOrigin {
  return typeof value === 'string' && (TASK_ORIGINS as readonly string[]).includes(value)
}

// --- Links -------------------------------------------------------------------

/**
 * The `RecordLink.fromObject` value a note/task link is written with. A link row
 * says "this note points at that record", so the FROM end is the note or task.
 */
export const LINK_SOURCE_NOTE = 'note'
export const LINK_SOURCE_TASK = 'task'

/**
 * The three table-backed spine objects a link may target directly. Anything else
 * a caller names is looked up as a custom ObjectDef slug by the route, so this is
 * NOT the allowlist — it is the set whose targets are verified against a real
 * table rather than against the generic Record table.
 *
 * The order matters in one place only: `rollUpSpineLinks` reads it to decide
 * which single company/person/deal a note's feed row carries.
 */
export const SPINE_LINK_OBJECTS = ['person', 'company', 'deal'] as const
export type SpineLinkObject = (typeof SPINE_LINK_OBJECTS)[number]

export function isSpineLinkObject(value: unknown): value is SpineLinkObject {
  return typeof value === 'string' && (SPINE_LINK_OBJECTS as readonly string[]).includes(value)
}

/** One attachment, as a client states it and as the API returns it. */
export interface LinkTarget {
  object: string
  id: string
}

/**
 * The links of a note or task, as a client sees them.
 *
 * `toObject`/`toId` are renamed to `object`/`id` on the way out: the storage names
 * are directional because RecordLink is a generic edge table, but from a note's
 * point of view there is only one end that is not itself.
 */
export function mapLinksToApi(
  links: Pick<RecordLink, 'toObject' | 'toId'>[],
): LinkTarget[] {
  return links.map((link) => ({ object: link.toObject, id: link.toId }))
}

/**
 * The at-most-one company / person / deal a feed row can carry, picked out of a
 * note's many links.
 *
 * ActivityEntry has ONE nullable column per spine object, because a feed row
 * lands on one account page. A note attached to two people therefore contributes
 * its FIRST person link to the feed and keeps both attachments on itself — the
 * links are the truth, the feed row is a cache (server/src/crm/activityFeed.ts).
 * Returning the first rather than refusing is deliberate: a note on two people is
 * a completely normal note, and dropping it out of the feed entirely to avoid
 * choosing would be the worse answer.
 */
export function rollUpSpineLinks(links: LinkTarget[]): {
  personId: string | null
  companyId: string | null
  dealId: string | null
} {
  const first = (object: SpineLinkObject): string | null =>
    links.find((link) => link.object === object)?.id ?? null
  return {
    personId: first('person'),
    companyId: first('company'),
    dealId: first('deal'),
  }
}

// --- TipTap: the one place a document becomes searchable text -----------------

/**
 * How much flattened text a note keeps. A note is prose, not a document store,
 * and `bodyText` exists to be searched and previewed — past this the extra bytes
 * are indexed weight nobody queries. The document itself is kept in full in
 * `bodyJson`, so nothing is lost from what renders.
 */
export const BODY_TEXT_MAX_LENGTH = 20_000

/**
 * A TipTap/ProseMirror node, as much of it as flattening needs to know.
 *
 * Structurally typed rather than imported: the editor's own types live in the
 * client bundle, and the server must be able to read a document written by any
 * version of it. An unknown node type is walked for children rather than
 * rejected, so a note containing a custom node the server has never heard of
 * still contributes the text inside it.
 */
interface ProseMirrorNode {
  type?: unknown
  text?: unknown
  content?: unknown
}

// Node types that end a line. A paragraph and a heading are separate lines in the
// rendered note, and joining them with nothing would fuse the last word of one to
// the first word of the next — "…the dealNext steps" — which is a phrase that
// matches neither search.
const BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'code_block',
  'listItem',
  'list_item',
  'bulletList',
  'bullet_list',
  'orderedList',
  'ordered_list',
  'taskItem',
  'task_item',
  'tableRow',
  'table_row',
  'horizontalRule',
  'horizontal_rule',
])

function isNode(value: unknown): value is ProseMirrorNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walk(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return
  }
  if (!isNode(node)) return

  const type = typeof node.type === 'string' ? node.type : ''

  // A hard break is a newline inside a paragraph — the one inline node that is
  // not text but still separates words.
  if (type === 'hardBreak' || type === 'hard_break') {
    out.push('\n')
    return
  }
  if (typeof node.text === 'string') {
    out.push(node.text)
  }
  if (node.content !== undefined) {
    walk(node.content, out)
  }
  if (BLOCK_NODE_TYPES.has(type)) {
    out.push('\n')
  }
}

/**
 * Flattens a TipTap document to the plain text stored in `Note.bodyText`.
 *
 * This is the ONLY place that conversion happens, and the routes call it on every
 * write, so the searchable text and the rendered document can never describe
 * different notes. See rule 1 in the module header for why that matters more than
 * it sounds like it does.
 *
 * Whitespace is normalised on the way out — runs of spaces collapse, runs of
 * blank lines collapse to one — because a document arrives full of structural
 * newlines that a search index and a feed preview both do better without. Returns
 * `""` for an empty or unrecognisable document rather than throwing: a note whose
 * body is a picture is a real note, and it must still save.
 */
export function flattenTipTapText(bodyJson: unknown): string {
  const parts: string[] = []
  walk(bodyJson, parts)
  const text = parts
    .join('')
    // Collapse horizontal whitespace, but not newlines — the line structure is
    // the part worth keeping.
    .replace(/[^\S\n]+/g, ' ')
    // Trim each line, then collapse blank runs.
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return text.length > BODY_TEXT_MAX_LENGTH ? text.slice(0, BODY_TEXT_MAX_LENGTH) : text
}

// --- Mappers: database row → API shape ---------------------------------------

/**
 * One task, as a client sees it.
 *
 * `origin` and `eventId` BOTH ride out, and neither is inferred from the other:
 * `origin` is where the task came from and `eventId` is what it points at. A
 * hand-made task linked to a meeting has an eventId and `origin: "manual"`, and a
 * client that collapsed those two into one "is it from the calendar" flag would
 * be about to let a sync delete it.
 *
 * `links` is present only when the caller loaded them — a list row does not pay
 * for a join it does not render.
 */
export function mapTaskToApi(
  task: Task & { links?: Pick<RecordLink, 'toObject' | 'toId'>[] },
) {
  return {
    id: task.id,
    title: task.title,
    body: task.body,
    type: task.type,
    priority: task.priority,
    commitment: task.commitment,
    assigneeUserId: task.assigneeUserId,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    remindAt: task.remindAt ? task.remindAt.toISOString() : null,
    eventId: task.eventId,
    origin: task.origin,
    isDone: task.isDone,
    doneAt: task.doneAt ? task.doneAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    ...(task.links ? { links: mapLinksToApi(task.links) } : {}),
  }
}

/**
 * One note, as a client sees it.
 *
 * BOTH bodies cross the wire: `bodyJson` is what the editor loads and `bodyText`
 * is what a list row renders and what a search result highlights. Sending only
 * the JSON would make every list row instantiate an editor to show one line of
 * text; sending only the text would lose the formatting on the way back into the
 * editor.
 */
export function mapNoteToApi(
  note: Note & { links?: Pick<RecordLink, 'toObject' | 'toId'>[] },
) {
  return {
    id: note.id,
    bodyJson: note.bodyJson,
    bodyText: note.bodyText,
    authorUserId: note.authorUserId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    ...(note.links ? { links: mapLinksToApi(note.links) } : {}),
  }
}
