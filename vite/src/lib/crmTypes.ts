/**
 * Client-side shapes for `ObjectDef`/`AttributeDef` and the generic record list
 * endpoint (server/src/routes/objects.ts, server/src/crm/recordList.ts). Mirrors
 * the server's API mappers field-for-field.
 */

export type AttributeType =
  | 'text'
  | 'number'
  | 'currency'
  | 'rating'
  | 'date'
  | 'timestamp'
  | 'phone'
  | 'email'
  | 'url'
  | 'domain'
  | 'select'
  | 'status'
  | 'multiselect'
  | 'checkbox'
  | 'record_reference'
  | 'location'
  | 'person_name'
  | 'user_reference'
  | 'ai'

// The shape of one `AttributeDef.optionsJson` entry for select/status/multiselect
// (server/src/crm/valuesValidator.ts's `allowedOptionValues`).
export interface AttributeOption {
  value: string
  label: string
  color?: string
  order?: number
  isArchived?: boolean
}

// The shape of one `AttributeDef.formatJson` entry (MAI-365). Display-only: the
// stored value stays canonical; this only changes how a cell renders it.
export interface FieldFormat {
  // number/currency/rating — Intl.NumberFormat options.
  number?: {
    style?: 'decimal' | 'currency' | 'percent'
    currency?: string
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  }
  // date/timestamp — an Intl.DateTimeFormat preset.
  date?: {
    preset?: 'short' | 'medium' | 'long' | 'full'
  }
  // text — a literal mask (e.g. "(###) ###-####").
  mask?: string
}

// The shape of one `AttributeDef.validationJson` entry (MAI-365). Enforced by
// server/src/crm/valuesValidator.ts; `strict` hard-blocks, otherwise accept-but-flag.
export interface FieldValidation {
  min?: number
  max?: number
  pattern?: string
  message?: string
  strict?: boolean
}

export interface AttributeDef {
  id: string
  objectId: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  type: AttributeType
  optionsJson: unknown
  refObjectId: string | null
  formatJson: unknown
  validationJson: unknown
  isIdentity: boolean
  storage: 'column' | 'custom' | 'list'
  isMulti: boolean
  isRequired: boolean
  isUnique: boolean
  isReadOnly: boolean
  isSystem: boolean
  defaultJson: unknown
  sortOrder: number
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export interface ObjectDef {
  id: string
  slug: string
  name: string
  namePlural: string
  icon: string | null
  iconColor: string | null
  storage: 'table' | 'record'
  isStandard: boolean
  isFirstClass: boolean
  isGridCreateSupported: boolean
  capabilities: {
    list: boolean
  }
  isHidden: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
  attributes?: AttributeDef[]
}

export interface ObjectDefWithAttributes extends ObjectDef {
  attributes: AttributeDef[]
}

export interface GetObjectsResponse {
  objects: ObjectDef[]
}

export interface GetObjectResponse {
  object: ObjectDefWithAttributes
}

export interface CreateObjectRequest {
  slug: string
  name: string
  namePlural: string
  icon?: string
  iconColor?: string
  isFirstClass?: boolean
  timelineEventsEnabled?: boolean
}

export interface PatchObjectRequest {
  name?: string
  namePlural?: string
  icon?: string
  iconColor?: string
  isFirstClass?: boolean
  timelineEventsEnabled?: boolean
  isHidden?: boolean
  isArchived?: boolean
}

export interface CreateObjectResponse {
  object: ObjectDef
}

export type PatchObjectResponse = CreateObjectResponse

export interface CreateAttributeRequest {
  objectId: string
  slug: string
  name: string
  type: AttributeType
  description?: string
  icon?: string
  storage?: Exclude<AttributeDef['storage'], 'column'>
  optionsJson?: AttributeOption[]
  refObjectId?: string
  formatJson?: FieldFormat
  validationJson?: FieldValidation
  defaultJson?: unknown
  isIdentity?: boolean
  isMulti?: boolean
  isRequired?: boolean
  isUnique?: boolean
  isReadOnly?: boolean
  sortOrder?: number
}

export interface PatchAttributeRequest {
  name?: string
  description?: string
  icon?: string
  type?: AttributeType
  storage?: AttributeDef['storage']
  optionsJson?: AttributeOption[]
  refObjectId?: string
  formatJson?: FieldFormat
  validationJson?: FieldValidation
  defaultJson?: unknown
  isIdentity?: boolean
  isMulti?: boolean
  isRequired?: boolean
  isUnique?: boolean
  isReadOnly?: boolean
  isArchived?: boolean
  sortOrder?: number
  resolveMultiToSingle?: boolean
}

export interface CreateAttributeResponse {
  attribute: AttributeDef
}

export type PatchAttributeResponse = CreateAttributeResponse

export interface RelatedRecordGroup {
  id: string
  label: string
  direction: 'inbound' | 'outbound' | 'context'
  object: ObjectDefWithAttributes
  attributeName: string | null
  count: number
  records: RecordRow[]
}

export interface GetRelatedRecordsResponse {
  related: RelatedRecordGroup[]
}

// A row from the list endpoint: system fields plus one key per readable
// attribute slug. Values are whatever the server sent — coercion into a
// displayable string happens where the grid renders the cell.
export type RecordRow = Record<string, unknown> & {
  id: string
  createdAt: string
  updatedAt: string
  isArchived?: boolean
}

export interface RecordSort {
  field: string
  direction: 'asc' | 'desc'
}

export interface ListRecordsResponse {
  rows: RecordRow[]
  nextCursor: string | null
  totalCount: number
}

export type RecordBulkSelection =
  | { mode: 'ids'; ids: string[] }
  | { mode: 'filter'; filter?: unknown; teamScope?: unknown }

export type RecordBulkAction =
  | { type: 'delete' }
  | { type: 'changeOwner'; ownerUserId: string | null }
  | { type: 'addToList'; listId: string }
  | { type: 'export' }

export interface BulkRecordsResponse {
  affectedCount: number
}

export interface BulkExportResponse {
  rows: RecordRow[]
  totalCount: number
}

/** One changed cell in a bounded window, summarized by the field-history reader. */
export interface FieldChange {
  recordId: string
  attributeId: string
  changeCount: number
  previousValue: unknown
  currentValue: unknown
  changedAt: string
}

export interface GetFieldChangesResponse {
  changes: FieldChange[]
}

export interface FieldHistoryEntry {
  id: string
  recordId: string
  attribute: string
  oldValue: unknown
  newValue: unknown
  changedByUserId: string | null
  actor: { name: string; avatarUrl: string | null } | null
  changeSource: string
  reason: string | null
  changedAt: string
}

export interface GetFieldHistoryResponse {
  history: FieldHistoryEntry[]
  nextCursor: string | null
}

export interface ObjectImpactReference {
  objectName: string
  fieldName: string
  count: number
}

export interface GetObjectImpactResponse {
  recordCount: number
  references: ObjectImpactReference[]
}

export interface GetAttributeImpactResponse {
  valueCount: number
}

export type CrmObject = ObjectDef

export interface CrmList {
  id: string
  name: string
  slug: string
  objectSlug: string
  description: string | null
  icon: string | null
  ownerUserId: string | null
  isShared: boolean
  sortOrder: number
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export type GetCrmObjectsResponse = GetObjectsResponse

export interface GetCrmListResponse {
  list: CrmList
}

/** One saved-list membership row, its list-only values, and its read-only target record. */
export interface CrmListEntry {
  id: string
  listId: string
  objectSlug: string
  targetId: string
  values: Record<string, unknown>
  position: number | null
  addedByUserId: string
  createdAt: string
  updatedAt: string
  target: RecordRow | null
}

export interface GetCrmListEntriesResponse {
  entries: CrmListEntry[]
  total: number
  page: number
  limit: number
}

export interface GetCrmListsResponse {
  lists: CrmList[]
  total: number
  page: number
  limit: number
}

// Mirrors server/src/crm/activityFeed.ts's mapActivityToApi (GET /api/orgs/:orgId/activity).
export interface ActivityEntryApi {
  id: string
  sourceType: string
  sourceId: string
  summary: string
  preview: string | null
  direction: string | null
  occurredAt: string
  createdByUserId: string | null
  companyId: string | null
  personId: string | null
  dealId: string | null
  createdAt: string
}

export interface GetActivityResponse {
  activity: ActivityEntryApi[]
  page: number
  limit: number
  hasMore: boolean
}
