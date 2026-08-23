import type { PrismaClient } from '../generated/prisma/client.js'

/** The narrow database surface required to validate structured teammate mentions. */
export type MentionResolverClient = Pick<PrismaClient, 'membership'>

/** The narrow database surface required to resolve an inbox target for one viewer. */
export type NotificationDestinationClient = Pick<PrismaClient, 'membership' | 'call'>

export interface ResolvedTeammateMentions {
  // These are the only IDs a caller may hand to the notification writer.
  recipientUserIds: string[]
  // The source can use this to reject a forged, inactive, or foreign mention.
  rejectedUserIds: string[]
}

/**
 * A target stored on NotificationObject. The strings remain schema-flexible, but
 * the resolver only recognizes an explicit allowlist of destination kinds.
 */
export interface NotificationTarget {
  objectType: string
  objectId: string
}

export type NotificationDestination =
  | { kind: 'available'; path: string }
  | { kind: 'unavailable' }

function nonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

/**
 * Extract teammate IDs exclusively from structured TipTap `mention` nodes.
 * Plain text such as "@sam" never becomes a recipient, and attributes are never
 * recursively inspected. A contact/company/deal chip is a record link, never a
 * user notification, so only the editor's canonical `attrs.kind === 'teammate'`
 * plus its `attrs.id` is trusted. Mentions written before chips gained a
 * `kind` attribute are legacy teammate mentions, so they retain their
 * established validation and notification semantics. Explicit record kinds
 * are never recipients.
 */
export function extractTipTapMentionUserIds(content: unknown): string[] {
  const ids: string[] = []
  const seenIds = new Set<string>()
  const visited = new WeakSet<object>()

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    if (visited.has(node)) return
    visited.add(node)

    const record = node as { type?: unknown; attrs?: unknown; content?: unknown }
    if (record.type === 'mention' && record.attrs !== null && typeof record.attrs === 'object') {
      const attrs = record.attrs as { id?: unknown; kind?: unknown }
      const userId =
        attrs.kind === undefined || attrs.kind === 'teammate' ? nonBlankString(attrs.id) : null
      if (userId && !seenIds.has(userId)) {
        seenIds.add(userId)
        ids.push(userId)
      }
    }
    visit(record.content)
  }

  visit(content)
  return ids
}

async function resolveCandidateTeammates(
  client: MentionResolverClient,
  orgId: string,
  candidateUserIds: string[],
): Promise<ResolvedTeammateMentions> {
  if (candidateUserIds.length === 0) return { recipientUserIds: [], rejectedUserIds: [] }

  const activeMembers = await client.membership.findMany({
    where: { orgId, isActive: true, userId: { in: candidateUserIds } },
    select: { userId: true },
  })
  const activeUserIds = new Set(activeMembers.map((member) => member.userId))

  return {
    recipientUserIds: candidateUserIds.filter((userId) => activeUserIds.has(userId)),
    rejectedUserIds: candidateUserIds.filter((userId) => !activeUserIds.has(userId)),
  }
}

/**
 * Validate the recipient IDs extracted from one TipTap document against active
 * memberships in the source object's organization. A rich-text ID is only a
 * candidate until this server-side tenancy check completes.
 */
export async function resolveTeammateMentions(
  client: MentionResolverClient,
  args: { orgId: string; content: unknown },
): Promise<ResolvedTeammateMentions> {
  const orgId = nonBlankString(args.orgId)
  if (!orgId) return { recipientUserIds: [], rejectedUserIds: extractTipTapMentionUserIds(args.content) }
  return resolveCandidateTeammates(client, orgId, extractTipTapMentionUserIds(args.content))
}

/**
 * Validate only additions relative to the previous TipTap document. Event
 * writers use this on edits, preventing unchanged mentions from being fanned out
 * again while still rejecting newly forged, inactive, or foreign IDs.
 */
export async function resolveNewTeammateMentions(
  client: MentionResolverClient,
  args: { orgId: string; previousContent: unknown; content: unknown },
): Promise<ResolvedTeammateMentions> {
  const previousUserIds = new Set(extractTipTapMentionUserIds(args.previousContent))
  const candidateUserIds = extractTipTapMentionUserIds(args.content).filter(
    (userId) => !previousUserIds.has(userId),
  )
  const orgId = nonBlankString(args.orgId)
  if (!orgId) return { recipientUserIds: [], rejectedUserIds: candidateUserIds }
  return resolveCandidateTeammates(client, orgId, candidateUserIds)
}

/**
 * Resolve a persisted NotificationObject target for a specific viewer. The
 * returned path is never based on the object ID alone: both the viewer's active
 * membership and the source row's organization-scoped existence must hold.
 */
export async function resolveNotificationDestination(
  client: NotificationDestinationClient,
  args: { orgId: string; viewerUserId: string; target: NotificationTarget },
): Promise<NotificationDestination> {
  const orgId = nonBlankString(args.orgId)
  const viewerUserId = nonBlankString(args.viewerUserId)
  const objectType = nonBlankString(args.target?.objectType)
  const objectId = nonBlankString(args.target?.objectId)
  if (!orgId || !viewerUserId || !objectType || !objectId) return { kind: 'unavailable' }

  const membership = await client.membership.findFirst({
    where: { orgId, userId: viewerUserId, isActive: true },
    select: { userId: true },
  })
  if (!membership) return { kind: 'unavailable' }

  if (objectType !== 'call') return { kind: 'unavailable' }

  const call = await client.call.findFirst({
    where: { id: objectId, orgId },
    select: { id: true },
  })
  if (!call) return { kind: 'unavailable' }

  return { kind: 'available', path: `/calls/${encodeURIComponent(call.id)}` }
}
