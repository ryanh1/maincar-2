/**
 * The configurable capture-exclusion evaluator (doc 5 §5.2f).
 *
 * This is the pluggable hook the matcher (server/src/lib/crmMatch.ts) calls at
 * step 2 — "apply exclusions first" — before it resolves participants to CRM
 * records. It is a pure function over the org's CaptureSettings row, so the
 * matcher stays a shared service and the settings surface stays the only place
 * these rules are edited.
 *
 * The rules split into two kinds:
 *  - whole-message: per-user opt-out, what-to-log, subject keyword, internal-only,
 *    bulk-inbound — one of these excludes the entire message.
 *  - per-participant: role-address auto-exclude, address excludes, domain
 *    allow/deny — these drop individual addresses; the message is excluded only
 *    when every participant is dropped.
 *
 * Bounce/auto-reply and invalid-address/public-domain classification are NOT here:
 * they are matcher-level (MAI-435), not configurable settings.
 */
import { normalizeParticipantAddress } from './crmMatch.js'

export const ROLE_LOCAL_PARTS = new Set([
  'abuse',
  'admin',
  'billing',
  'hello',
  'info',
  'mailer-daemon',
  'no-reply',
  'noreply',
  'notifications',
  'postmaster',
  'sales',
  'support',
])

export type LogActivityType = 'email' | 'meetings' | 'both'

export interface CaptureSettings {
  internalDomains: string[]
  allowDomains: string[]
  excludeDomains: string[]
  excludeAddresses: string[]
  excludeRoleAddresses: boolean
  dropBulkInbound: boolean
  bulkInboundMax: number
  subjectExcludes: string[]
  logActivityTypes: LogActivityType
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  internalDomains: [],
  allowDomains: [],
  excludeDomains: [],
  excludeAddresses: [],
  excludeRoleAddresses: true,
  dropBulkInbound: true,
  bulkInboundMax: 15,
  subjectExcludes: [],
  logActivityTypes: 'both',
}

export type CaptureExclusion =
  | 'user_opt_out'
  | 'not_logged'
  | 'subject_keyword'
  | 'address_excluded'
  | 'domain_denied'
  | 'domain_not_allowed'
  | 'role_address'
  | 'internal_only'
  | 'bulk_inbound'

export interface CaptureExclusionInput<P extends { address: string } = { address: string }> {
  participants: P[]
  subject?: string | null
  direction?: 'inbound' | 'outbound'
  activityType: 'email' | 'meeting'
  /** True when the mailbox owner has opted their own mailbox out of capture. */
  optedOut?: boolean
}

export interface CaptureExclusionResult<P extends { address: string } = { address: string }> {
  excluded: boolean
  exclusion: CaptureExclusion | null
  /** Participants that survived the per-participant rules, in input order. */
  eligibleParticipants: P[]
}

function domainOf(address: string): string {
  return normalizeParticipantAddress(address).split('@')[1] ?? ''
}

function isRoleAddress(address: string): boolean {
  const localPart = normalizeParticipantAddress(address).split('@')[0] ?? ''
  return ROLE_LOCAL_PARTS.has(localPart)
}

/**
 * Match a subject against one exclude phrase. A phrase wrapped in double quotes
 * is an exact (whole-subject) match; otherwise it is a case-insensitive substring.
 */
function subjectMatches(subject: string, phrase: string): boolean {
  const trimmed = phrase.trim()
  const lower = subject.toLowerCase()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return lower === trimmed.slice(1, -1).toLowerCase()
  }
  return trimmed.length > 0 && lower.includes(trimmed.toLowerCase())
}

/**
 * Apply every configurable exclusion rule in the documented order and return the
 * decision plus the addresses that survived the per-participant rules.
 */
export function evaluateCaptureExclusions<P extends { address: string }>(
  settings: CaptureSettings,
  input: CaptureExclusionInput<P>,
): CaptureExclusionResult<P> {
  const internalDomains = new Set(settings.internalDomains.map((d) => d.trim().toLowerCase()).filter(Boolean))
  const allowDomains = new Set(settings.allowDomains.map((d) => d.trim().toLowerCase()).filter(Boolean))
  const excludeDomains = new Set(settings.excludeDomains.map((d) => d.trim().toLowerCase()).filter(Boolean))
  const excludeAddresses = new Set(settings.excludeAddresses.map((a) => normalizeParticipantAddress(a)).filter(Boolean))

  // Whole-message rules first: they are cheaper and short-circuit the rest.
  if (input.optedOut) return { excluded: true, exclusion: 'user_opt_out', eligibleParticipants: [] }
  const logsEmail = settings.logActivityTypes === 'email' || settings.logActivityTypes === 'both'
  const logsMeetings = settings.logActivityTypes === 'meetings' || settings.logActivityTypes === 'both'
  const isLogged = input.activityType === 'email' ? logsEmail : logsMeetings
  if (!isLogged) {
    return { excluded: true, exclusion: 'not_logged', eligibleParticipants: [] }
  }
  if (input.subject) {
    for (const phrase of settings.subjectExcludes) {
      if (subjectMatches(input.subject, phrase)) {
        return { excluded: true, exclusion: 'subject_keyword', eligibleParticipants: [] }
      }
    }
  }

  // Per-participant rules. Track the first reason so an all-dropped message can
  // report why, mirroring the matcher's existing first-exclusion behavior.
  let firstExclusion: CaptureExclusion | null = null
  const eligibleParticipants: P[] = []
  for (const participant of input.participants) {
    const address = normalizeParticipantAddress(participant.address)
    const domain = domainOf(address)

    if (settings.excludeRoleAddresses && isRoleAddress(address)) {
      firstExclusion ??= 'role_address'
      continue
    }
    if (excludeAddresses.has(address)) {
      firstExclusion ??= 'address_excluded'
      continue
    }
    if (excludeDomains.has(domain)) {
      firstExclusion ??= 'domain_denied'
      continue
    }
    if (allowDomains.size > 0 && !allowDomains.has(domain)) {
      firstExclusion ??= 'domain_not_allowed'
      continue
    }
    eligibleParticipants.push(participant)
  }

  if (eligibleParticipants.length === 0) {
    return { excluded: true, exclusion: firstExclusion ?? 'address_excluded', eligibleParticipants: [] }
  }

  // Internal-only: every surviving participant is on an internal domain.
  if (
    internalDomains.size > 0 &&
    eligibleParticipants.every((participant) => internalDomains.has(domainOf(participant.address)))
  ) {
    return { excluded: true, exclusion: 'internal_only', eligibleParticipants: [] }
  }

  // Bulk inbound: more than the threshold of non-CRM recipients is a blast.
  if (
    settings.dropBulkInbound &&
    input.direction === 'inbound' &&
    eligibleParticipants.length > settings.bulkInboundMax
  ) {
    return { excluded: true, exclusion: 'bulk_inbound', eligibleParticipants: [] }
  }

  return { excluded: false, exclusion: null, eligibleParticipants }
}
