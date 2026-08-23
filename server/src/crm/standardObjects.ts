/**
 * The standard CRM schema, expressed as data (spec §10.1).
 *
 * `seedOrg` (see ./seedOrg.ts) reads this file to give every new org its standard
 * ObjectDefs, their column AttributeDefs, a few seeded custom fields, the editable
 * picklist option lists, and a default sales Pipeline. Editing THIS file and
 * bumping CURRENT_SEED_VERSION is how a later release ships a new standard field:
 * the versioned, insert-missing-only backfill then adds it to existing orgs
 * without ever overwriting a renamed label or a user-added option (spec §10.2).
 *
 * Storage vs. reality: an ObjectDef with storage "table" describes a real Postgres
 * table; storage "column" on an AttributeDef means the value lives in a real column
 * on that table (isSystem, so it can be renamed/hidden but never deleted/retyped),
 * while "custom" means it lives in customJson. We therefore seed COLUMN attributes
 * only for the objects whose tables exist today — person, company, deal, call.
 * The email / sms / meeting / task / note ObjectDefs are seeded (a new org must
 * list every standard object), but their column attributes are seeded when those
 * tables land in Phase 3/4 (plan T9–T13). This keeps the field metadata honest
 * about what the database can actually enforce.
 */

// Bump this when this file adds a standard object, field, or default option. The
// backfill compares an org's stored seedVersion against it to decide whether to
// re-run the insert-missing-only pass (spec §10.2).
export const CURRENT_SEED_VERSION = 3

export interface SeedDisposition {
  value: string
  label: string
  color: string
  category: 'connected' | 'not_connected'
  isPinned: boolean
  pinOrder: number | null
  sortOrder: number
}

// A new organization starts with a practical call-outcome set. Labels and
// colors remain editable; the stable values are what reporting filters use.
export const STANDARD_DISPOSITIONS: SeedDisposition[] = [
  { value: 'connected', label: 'Connected', color: 'option-1', category: 'connected', isPinned: true, pinOrder: 0, sortOrder: 0 },
  { value: 'voicemail', label: 'Left voicemail', color: 'option-2', category: 'not_connected', isPinned: true, pinOrder: 1, sortOrder: 1 },
  { value: 'no_answer', label: 'No answer', color: 'option-3', category: 'not_connected', isPinned: true, pinOrder: 2, sortOrder: 2 },
  { value: 'busy', label: 'Busy', color: 'option-4', category: 'not_connected', isPinned: true, pinOrder: 3, sortOrder: 3 },
  { value: 'wrong_number', label: 'Wrong number', color: 'option-5', category: 'not_connected', isPinned: true, pinOrder: 4, sortOrder: 4 },
  { value: 'not_interested', label: 'Not interested', color: 'option-6', category: 'connected', isPinned: true, pinOrder: 5, sortOrder: 5 },
  { value: 'callback', label: 'Call back', color: 'option-7', category: 'connected', isPinned: true, pinOrder: 6, sortOrder: 6 },
]

// One editable picklist option (spec §5.6a). The record stores `value`; the UI
// shows `label`. Renaming a label never rewrites a record, and retiring an option
// sets isArchived rather than removing it, so existing records keep their value.
export interface SeedOption {
  value: string
  label: string
  color: string
  order: number
  isArchived: boolean
}

// A field on a standard object. `type` is a semantic type from spec §8.
// `refObjectSlug` (for record_reference) is resolved to a real refObjectId at seed
// time, once the target ObjectDef row exists.
export interface SeedAttribute {
  slug: string
  name: string
  type: string
  storage: 'column' | 'custom' | 'list'
  sortOrder: number
  description?: string
  isSystem?: boolean
  isIdentity?: boolean
  isRequired?: boolean
  isUnique?: boolean
  isMulti?: boolean
  isReadOnly?: boolean
  refObjectSlug?: string
  optionsJson?: SeedOption[]
}

export interface SeedObject {
  slug: string
  name: string
  namePlural: string
  storage: 'table' | 'record'
  icon: string
  isFirstClass: boolean
  attributes: SeedAttribute[]
}

/** Server-owned, user-navigable surfaces for a standard object. */
export interface ObjectSurfaceCapabilities {
  list: boolean
}

export interface SeedStage {
  name: string
  color: string
  sortOrder: number
  winProbability: number
  outcome: 'open' | 'won' | 'lost'
}

export interface SeedPipeline {
  name: string
  stages: SeedStage[]
}

// --- Option lists (spec §10.1) -------------------------------------------------
// Every option ships with a curated color + order and isArchived = false.

function opt(value: string, label: string, color: string, order: number): SeedOption {
  return { value, label, color, order, isArchived: false }
}

// A fixed system enum the app branches on — user cannot add values (spec §5.6a),
// but the option list still carries labels/colors for rendering.
const ATTENTION_STATUS_OPTIONS: SeedOption[] = [
  opt('on_deck', 'On deck', '#10b981', 0),
  opt('on_hold', 'On hold', '#f59e0b', 1),
  opt('backburner', 'Backburner', '#64748b', 2),
  opt('disqualified', 'Disqualified', '#ef4444', 3),
]

const DEAL_STATUS_OPTIONS: SeedOption[] = [
  opt('open', 'Open', '#3b82f6', 0),
  opt('won', 'Won', '#10b981', 1),
  opt('lost', 'Lost', '#ef4444', 2),
]

const CALL_DIRECTION_OPTIONS: SeedOption[] = [
  opt('inbound', 'Inbound', '#10b981', 0),
  opt('outbound', 'Outbound', '#3b82f6', 1),
]

// User-owned picklists — the user may add/rename/recolor/retire options over time.
const COMPANY_TYPE_OPTIONS: SeedOption[] = [
  opt('saas', 'SaaS', '#6366f1', 0),
  opt('agency', 'Agency', '#ec4899', 1),
  opt('manufacturer', 'Manufacturer', '#f59e0b', 2),
  opt('retailer', 'Retailer', '#10b981', 3),
  opt('services', 'Services', '#3b82f6', 4),
  opt('non_profit', 'Non-profit', '#14b8a6', 5),
  opt('other', 'Other', '#94a3b8', 6),
]

const SOURCE_OPTIONS: SeedOption[] = [
  opt('manual', 'Manual', '#94a3b8', 0),
  opt('import', 'Import', '#64748b', 1),
  opt('enrichment', 'Enrichment', '#8b5cf6', 2),
  opt('inbound_call', 'Inbound call', '#10b981', 3),
  opt('referral', 'Referral', '#f59e0b', 4),
  opt('other', 'Other', '#cbd5e1', 5),
]

const LOST_REASON_OPTIONS: SeedOption[] = [
  opt('price', 'Price', '#ef4444', 0),
  opt('timing', 'Timing', '#f59e0b', 1),
  opt('competitor', 'Competitor', '#ec4899', 2),
  opt('no_budget', 'No budget', '#eab308', 3),
  opt('no_decision', 'No decision', '#64748b', 4),
  opt('other', 'Other', '#94a3b8', 5),
]

// The canonical Deal segment used by standard reporting. The values remain
// editable through the normal field controls, while the system-owned slug is
// the stable reporting contract.
const DEAL_SEGMENT_OPTIONS: SeedOption[] = [
  opt('Enterprise', 'Enterprise', 'option-1', 0),
  opt('Mid-market', 'Mid-market', 'option-2', 1),
  opt('SMB', 'SMB', 'option-3', 2),
]

const ATTENTION_REASON_OPTIONS: SeedOption[] = [
  opt('other_stakeholder', 'Other stakeholder', '#6366f1', 0),
  opt('cooled', 'Cooled', '#3b82f6', 1),
  opt('timing', 'Timing', '#f59e0b', 2),
  opt('bad_fit', 'Bad fit', '#ef4444', 3),
  opt('other', 'Other', '#94a3b8', 4),
]

const PERSONA_OPTIONS: SeedOption[] = [
  opt('decision_maker', 'Decision maker', '#6366f1', 0),
  opt('gatekeeper', 'Gatekeeper', '#f59e0b', 1),
  opt('champion', 'Champion', '#10b981', 2),
  opt('influencer', 'Influencer', '#8b5cf6', 3),
  opt('user', 'User', '#3b82f6', 4),
  opt('other', 'Other', '#94a3b8', 5),
]

// --- Standard objects ----------------------------------------------------------

const PERSON: SeedObject = {
  slug: 'person',
  name: 'Person',
  namePlural: 'People',
  storage: 'table',
  icon: 'user',
  isFirstClass: true,
  attributes: [
    { slug: 'firstName', name: 'First name', type: 'person_name', storage: 'column', isSystem: true, isIdentity: true, sortOrder: 0 },
    { slug: 'lastName', name: 'Last name', type: 'person_name', storage: 'column', isSystem: true, sortOrder: 1 },
    { slug: 'preferredFirstName', name: 'Preferred name', type: 'text', storage: 'column', isSystem: true, sortOrder: 2 },
    { slug: 'title', name: 'Title', type: 'text', storage: 'column', isSystem: true, sortOrder: 3 },
    { slug: 'linkedinUrl', name: 'LinkedIn', type: 'url', storage: 'column', isSystem: true, isIdentity: true, sortOrder: 4 },
    { slug: 'companyId', name: 'Company', type: 'record_reference', storage: 'column', isSystem: true, refObjectSlug: 'company', sortOrder: 5 },
    { slug: 'ownerUserId', name: 'Owner', type: 'user_reference', storage: 'column', isSystem: true, sortOrder: 6 },
    { slug: 'persona', name: 'Persona', type: 'select', storage: 'column', isSystem: true, optionsJson: PERSONA_OPTIONS, sortOrder: 7 },
    { slug: 'attentionStatus', name: 'Attention', type: 'status', storage: 'column', isSystem: true, isRequired: true, optionsJson: ATTENTION_STATUS_OPTIONS, sortOrder: 8 },
    { slug: 'attentionReason', name: 'Attention reason', type: 'select', storage: 'column', isSystem: true, optionsJson: ATTENTION_REASON_OPTIONS, sortOrder: 9 },
    { slug: 'callbackDate', name: 'Callback date', type: 'date', storage: 'column', isSystem: true, sortOrder: 10 },
    { slug: 'timeZone', name: 'Time zone', type: 'text', storage: 'column', isSystem: true, sortOrder: 11 },
    { slug: 'source', name: 'Source', type: 'select', storage: 'column', isSystem: true, optionsJson: SOURCE_OPTIONS, sortOrder: 12 },
    { slug: 'lastContactedAt', name: 'Last contacted', type: 'timestamp', storage: 'column', isSystem: true, isReadOnly: true, sortOrder: 13 },
    // Seeded CUSTOM fields — the lower-value socials, enrichment-filled, kept out of
    // the Person table to keep it lean (spec §5.13). They live in customJson.
    { slug: 'x_url', name: 'X / Twitter', type: 'url', storage: 'custom', sortOrder: 14 },
    { slug: 'website_url', name: 'Website', type: 'url', storage: 'custom', sortOrder: 15 },
    { slug: 'github_url', name: 'GitHub', type: 'url', storage: 'custom', sortOrder: 16 },
  ],
}

const COMPANY: SeedObject = {
  slug: 'company',
  name: 'Company',
  namePlural: 'Companies',
  storage: 'table',
  icon: 'building-2',
  isFirstClass: true,
  attributes: [
    { slug: 'name', name: 'Name', type: 'text', storage: 'column', isSystem: true, isIdentity: true, sortOrder: 0 },
    { slug: 'legalName', name: 'Legal name', type: 'text', storage: 'column', isSystem: true, sortOrder: 1 },
    { slug: 'domain', name: 'Domain', type: 'domain', storage: 'column', isSystem: true, isIdentity: true, isUnique: true, sortOrder: 2 },
    { slug: 'companyType', name: 'Type', type: 'select', storage: 'column', isSystem: true, optionsJson: COMPANY_TYPE_OPTIONS, sortOrder: 3 },
    { slug: 'industry', name: 'Industry', type: 'text', storage: 'column', isSystem: true, sortOrder: 4 },
    { slug: 'sizeEmployees', name: 'Employees', type: 'number', storage: 'column', isSystem: true, sortOrder: 5 },
    { slug: 'linkedinUrl', name: 'LinkedIn', type: 'url', storage: 'column', isSystem: true, isIdentity: true, sortOrder: 6 },
    { slug: 'logoUrl', name: 'Logo', type: 'url', storage: 'column', isSystem: true, sortOrder: 7 },
    { slug: 'parentCompanyId', name: 'Parent company', type: 'record_reference', storage: 'column', isSystem: true, refObjectSlug: 'company', sortOrder: 8 },
    { slug: 'ownerUserId', name: 'Owner', type: 'user_reference', storage: 'column', isSystem: true, sortOrder: 9 },
    { slug: 'attentionStatus', name: 'Attention', type: 'status', storage: 'column', isSystem: true, isRequired: true, optionsJson: ATTENTION_STATUS_OPTIONS, sortOrder: 10 },
    { slug: 'attentionReason', name: 'Attention reason', type: 'select', storage: 'column', isSystem: true, optionsJson: ATTENTION_REASON_OPTIONS, sortOrder: 11 },
    { slug: 'callbackDate', name: 'Callback date', type: 'date', storage: 'column', isSystem: true, sortOrder: 12 },
    { slug: 'source', name: 'Source', type: 'select', storage: 'column', isSystem: true, optionsJson: SOURCE_OPTIONS, sortOrder: 13 },
  ],
}

const DEAL: SeedObject = {
  slug: 'deal',
  name: 'Deal',
  namePlural: 'Deals',
  storage: 'table',
  icon: 'circle-dollar-sign',
  isFirstClass: true,
  attributes: [
    { slug: 'name', name: 'Name', type: 'text', storage: 'column', isSystem: true, isRequired: true, sortOrder: 0 },
    { slug: 'companyId', name: 'Company', type: 'record_reference', storage: 'column', isSystem: true, refObjectSlug: 'company', sortOrder: 1 },
    { slug: 'amountMinor', name: 'Amount', type: 'currency', storage: 'column', isSystem: true, sortOrder: 2 },
    // stageId points at a PipelineStage row; its options ARE the pipeline's stages,
    // so no static optionsJson. Modeled as a status column the board reads.
    { slug: 'stageId', name: 'Stage', type: 'status', storage: 'column', isSystem: true, isRequired: true, sortOrder: 3 },
    { slug: 'status', name: 'Status', type: 'status', storage: 'column', isSystem: true, optionsJson: DEAL_STATUS_OPTIONS, sortOrder: 4 },
    { slug: 'closeDate', name: 'Close date', type: 'date', storage: 'column', isSystem: true, sortOrder: 5 },
    { slug: 'lostReason', name: 'Lost reason', type: 'select', storage: 'column', isSystem: true, optionsJson: LOST_REASON_OPTIONS, sortOrder: 6 },
    { slug: 'ownerUserId', name: 'Owner', type: 'user_reference', storage: 'column', isSystem: true, sortOrder: 7 },
    { slug: 'segment', name: 'Segment', type: 'select', storage: 'custom', isSystem: true, optionsJson: DEAL_SEGMENT_OPTIONS, sortOrder: 8 },
  ],
}

const CALL: SeedObject = {
  slug: 'call',
  name: 'Call',
  namePlural: 'Calls',
  storage: 'table',
  icon: 'phone',
  isFirstClass: true,
  attributes: [
    { slug: 'direction', name: 'Direction', type: 'select', storage: 'column', isSystem: true, isReadOnly: true, optionsJson: CALL_DIRECTION_OPTIONS, sortOrder: 0 },
    { slug: 'fromE164', name: 'From', type: 'phone', storage: 'column', isSystem: true, isReadOnly: true, sortOrder: 1 },
    { slug: 'toE164', name: 'To', type: 'phone', storage: 'column', isSystem: true, isReadOnly: true, sortOrder: 2 },
    { slug: 'status', name: 'Status', type: 'status', storage: 'column', isSystem: true, isReadOnly: true, sortOrder: 3 },
  ],
}

// ObjectDefs for the activity/work objects whose tables land in Phase 3/4. Seeded
// so a new org lists every standard object; their column attributes are added when
// their tables exist (see the file header note).
const EMAIL: SeedObject = { slug: 'email', name: 'Email', namePlural: 'Emails', storage: 'table', icon: 'mail', isFirstClass: true, attributes: [] }
const SMS: SeedObject = { slug: 'sms', name: 'Text', namePlural: 'Texts', storage: 'table', icon: 'message-square', isFirstClass: true, attributes: [] }
const MEETING: SeedObject = { slug: 'meeting', name: 'Meeting', namePlural: 'Meetings', storage: 'table', icon: 'calendar-clock', isFirstClass: true, attributes: [] }
const TASK: SeedObject = { slug: 'task', name: 'Task', namePlural: 'Tasks', storage: 'table', icon: 'square-check', isFirstClass: true, attributes: [] }
const NOTE: SeedObject = { slug: 'note', name: 'Note', namePlural: 'Notes', storage: 'table', icon: 'sticky-note', isFirstClass: true, attributes: [] }

// The order here is the navbar order and the seed order. Objects that are the
// target of a record_reference (company) are created before any object that points
// at them, so refObjectId always resolves.
export const STANDARD_OBJECTS: SeedObject[] = [
  COMPANY,
  PERSON,
  DEAL,
  CALL,
  EMAIL,
  SMS,
  MEETING,
  TASK,
  NOTE,
]

// Keep this adjacent to the standard-object registry, not in a client component:
// adding a first-class object is an explicit product decision about which surfaces
// it can safely expose. The registry test pairs this declaration with the real
// record-list implementation, so a new table-backed object cannot be advertised
// before its list query exists.
export const STANDARD_OBJECT_SURFACE_CAPABILITIES: Readonly<Record<string, ObjectSurfaceCapabilities>> = {
  company: { list: true },
  person: { list: true },
  deal: { list: true },
  call: { list: true },
  email: { list: false },
  sms: { list: false },
  meeting: { list: false },
  task: { list: false },
  note: { list: false },
}

// The one default pipeline every org starts with (spec §10.1). isDefault is set by
// the seeder. Exactly one is seeded; a second (e.g. "Renewals") needs no migration.
export const DEFAULT_PIPELINE: SeedPipeline = {
  name: 'New Business',
  stages: [
    { name: 'New', color: '#94a3b8', sortOrder: 0, winProbability: 0, outcome: 'open' },
    { name: 'Qualified', color: '#3b82f6', sortOrder: 1, winProbability: 25, outcome: 'open' },
    { name: 'Proposal', color: '#8b5cf6', sortOrder: 2, winProbability: 50, outcome: 'open' },
    { name: 'Negotiation', color: '#f59e0b', sortOrder: 3, winProbability: 75, outcome: 'open' },
    { name: 'Won', color: '#10b981', sortOrder: 4, winProbability: 100, outcome: 'won' },
    { name: 'Lost', color: '#ef4444', sortOrder: 5, winProbability: 0, outcome: 'lost' },
  ],
}
