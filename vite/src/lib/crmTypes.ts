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

// A row from the list endpoint: system fields plus one key per readable
// attribute slug. Values are whatever the server sent — coercion into a
// displayable string happens where the grid renders the cell.
export type RecordRow = Record<string, unknown> & {
  id: string
  createdAt: string
  updatedAt: string
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

export type CrmObject = ObjectDef

export interface CrmList {
  id: string
  name: string
  objectSlug: string
  isArchived: boolean
}

export type GetCrmObjectsResponse = GetObjectsResponse

export interface GetCrmListsResponse {
  lists: CrmList[]
  total: number
  page: number
  limit: number
}
