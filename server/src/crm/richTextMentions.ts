/**
 * richTextMentions — the durable, server-owned source and event contract for
 * rich-text teammate mentions (MAI-417).
 *
 * Two halves, one contract:
 *
 *   1. `sanitizeTipTapDocument` is the server-side allow-list for persisted
 *      TipTap JSON. It strips executable or presentation attributes a caller
 *      could smuggle into a document, while PRESERVING the identity of
 *      structured `mention` nodes — a teammate's stable user id or a linked
 *      record's stable id, plus its `kind` and `label`. Sanitization must never
 *      silently discard that identity, because the mention resolver
 *      (server/src/crm/mentions.ts) and the notification writer
 *      (server/src/crm/notifications.ts) both read it back out of the stored
 *      document.
 *
 *   2. `RichTextMentionSource` + `buildMentionEvent` is the canonical source
 *      contract. A rich-text surface names its organization, source type,
 *      source record, and actor once, and the contract derives the deterministic
 *      event key the notification writer uses for idempotent fan-out. No surface
 *      invents its own key shape.
 */
import type { NotificationEvent } from './notifications.js'

// --- Sanitization ------------------------------------------------------------

/** Attribute names that are never persisted, on any node or mark. */
const EVENT_HANDLER_ATTR = /^on/i

/** URL schemes that execute or smuggle markup. A `src`/`href` using one is dropped. */
const DANGEROUS_URL_SCHEME = /^(javascript|vbscript|data):/i

/**
 * The identity attributes a `mention` node keeps. `id` is the stable server id
 * (a user id for a teammate, a record id for a linked record); `kind` separates
 * a teammate from a contact/company/deal chip; `label` is the display text.
 * Everything else on a mention is dropped, so a forged `onclick` or `style`
 * cannot ride in on the one node the resolver trusts.
 */
const MENTION_IDENTITY_ATTRS = ['id', 'kind', 'label'] as const

function nonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function safeUrl(value: unknown): string | null {
  const url = nonBlankString(value)
  if (url === null) return null
  if (DANGEROUS_URL_SCHEME.test(url)) return null
  return url
}

/**
 * Reduce a mention node's attrs to exactly its identity. A mention whose `id`
 * is missing or blank is left without an `id`, which the resolver already treats
 * as "not a recipient" — the sanitizer preserves rather than invents.
 */
function sanitizeMentionAttrs(attrs: unknown): Record<string, unknown> | undefined {
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) return undefined
  const record = attrs as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of MENTION_IDENTITY_ATTRS) {
    const value = nonBlankString(record[key])
    if (value !== null) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Reduce a non-mention node's attrs to the safe subset. Event handlers and
 * `style` are dropped outright; `src`/`href` survive only with a safe scheme.
 * Unknown attributes are kept, because the editor gains node types and
 * attributes over time and a server that rejected an unfamiliar one would make a
 * client upgrade a breaking change — the same forward-compat rule the note route
 * already holds for node types.
 */
function sanitizeAttrs(attrs: unknown): Record<string, unknown> | undefined {
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (EVENT_HANDLER_ATTR.test(key)) continue
    if (key === 'style') continue
    if (key === 'src' || key === 'href') {
      const url = safeUrl(value)
      if (url !== null) out[key] = url
      continue
    }
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeNode)
  if (node === null || typeof node !== 'object') return node

  const record = node as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : null
  if (type === null) return node

  // A mention is an atom: its identity is its attrs, and nothing else survives.
  if (type === 'mention') {
    const attrs = sanitizeMentionAttrs(record.attrs)
    return attrs ? { type, attrs } : { type }
  }

  const out: Record<string, unknown> = { type }
  if (typeof record.text === 'string') out.text = record.text
  if (record.marks !== undefined) out.marks = sanitizeNode(record.marks)
  if (record.content !== undefined) out.content = sanitizeNode(record.content)

  const attrs = sanitizeAttrs(record.attrs)
  if (attrs) out.attrs = attrs

  return out
}

/**
 * Sanitize a TipTap document before it is persisted.
 *
 * The output is idempotent: sanitizing a sanitized document returns it
 * unchanged, so a document that round-trips through the editor and back through
 * the server on every autosave does not drift. Structured `mention` nodes keep
 * their `id`/`kind`/`label` identity; everything else loses executable and
 * presentation attributes.
 */
export function sanitizeTipTapDocument(content: unknown): unknown {
  return sanitizeNode(content)
}

// --- Source contract ---------------------------------------------------------

/**
 * The canonical identity of one rich-text update. A surface names these once and
 * the contract derives the deterministic event key the notification writer uses
 * for idempotent fan-out.
 */
export interface RichTextMentionSource {
  orgId: string
  // The source object type, e.g. "note". Doubles as the notification objectType.
  sourceType: string
  // The source record id, e.g. the note id. Doubles as the notification objectId.
  sourceId: string
  // The actor. The writer re-validates this is an active member of orgId.
  actorUserId: string
  // Human title for the notification snapshot, e.g. "You were mentioned in a note".
  title: string
}

/**
 * The deterministic event key for a source's mention fan-out. One source record
 * has exactly one mention event, so a retry upserts the same NotificationObject
 * instead of creating a second fan-out batch.
 */
export function mentionEventKey(source: Pick<RichTextMentionSource, 'sourceType' | 'sourceId'>): string {
  return `${source.sourceType}:${source.sourceId}:mentions:v1`
}

/**
 * Build the notification event for a rich-text update from its source contract
 * and the already-resolved recipient ids. The resolver (mentions.ts) has already
 * confirmed every candidate against the source org; the writer (notifications.ts)
 * repeats the membership boundary inside its own transaction.
 */
export function buildMentionEvent(
  source: RichTextMentionSource,
  args: { bodyText: string; recipientUserIds: readonly string[] },
): NotificationEvent {
  return {
    orgId: source.orgId,
    eventKey: mentionEventKey(source),
    actorUserId: source.actorUserId,
    verb: 'mentioned',
    object: {
      type: source.sourceType,
      id: source.sourceId,
      sourceSnapshot: {
        title: source.title,
        preview: args.bodyText.slice(0, 500) || 'A teammate mentioned you.',
      },
    },
    recipientUserIds: args.recipientUserIds,
  }
}
