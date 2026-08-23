/**
 * The only format for URL-owned workspace state. It deliberately contains
 * opaque identifiers and structural display choices, never values a person
 * typed or a record field can reveal.
 */
export const SETTINGS_SECTIONS = [
  'profile',
  'organization',
  'members',
  'teams',
  'numbers',
  'call-recordings',
  'dispositions',
  'next-steps',
  'voicemail-greeting',
  'email-templates',
  'signatures',
  'integrations',
  'data-model',
  'keyboard',
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export type WorkspaceSort = {
  attributeId: string
  direction: 'asc' | 'desc'
}

export type WorkspaceViewConfig = {
  sorts?: WorkspaceSort[]
  teamScope?: { teamIds?: string[]; leadUserIds?: string[] }
  layout?: {
    columns?: Array<{ attributeId: string; visible: boolean; order: number }>
    groupBy?: WorkspaceSort[]
    rowHeight?: 'compact' | 'comfortable' | 'tall'
    gridLines?: boolean
    frozenRows?: number
    frozenCols?: number
    zoom?: number
    columnWidths?: Record<string, number>
  }
}

export type WorkspaceUrlState = {
  activeViewId?: string
  selectedRecordId?: string
  viewConfig?: WorkspaceViewConfig
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const STATE_PARAM = 'ws'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${path}.${key} is not permitted in workspace URL state`)
  }
}

function readIdentifier(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${path} must be an opaque identifier`)
  return value
}

function readInteger(value: unknown, path: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}`)
  }
  return value as number
}

function readSorts(value: unknown, path: string): WorkspaceSort[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`${path}[${index}] must be an object`)
    assertKeys(entry, ['attributeId', 'direction'], `${path}[${index}]`)
    const attributeId = readIdentifier(entry.attributeId, `${path}[${index}].attributeId`)
    if (!attributeId || (entry.direction !== 'asc' && entry.direction !== 'desc')) {
      throw new Error(`${path}[${index}] must name an attribute and direction`)
    }
    return { attributeId, direction: entry.direction }
  })
}

function readIdentifierList(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return [...new Set(value.map((entry, index) => readIdentifier(entry, `${path}[${index}]`)!))]
}

function readViewConfig(value: unknown): WorkspaceViewConfig | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) throw new Error('viewConfig must be an object')
  assertKeys(value, ['sorts', 'teamScope', 'layout'], 'viewConfig')

  const sorts = readSorts(value.sorts, 'viewConfig.sorts')
  let teamScope: WorkspaceViewConfig['teamScope']
  if (value.teamScope !== undefined) {
    if (!isObject(value.teamScope)) throw new Error('viewConfig.teamScope must be an object')
    assertKeys(value.teamScope, ['teamIds', 'leadUserIds'], 'viewConfig.teamScope')
    const teamIds = readIdentifierList(value.teamScope.teamIds, 'viewConfig.teamScope.teamIds')
    const leadUserIds = readIdentifierList(value.teamScope.leadUserIds, 'viewConfig.teamScope.leadUserIds')
    if (teamIds?.length || leadUserIds?.length) {
      teamScope = { ...(teamIds?.length ? { teamIds } : {}), ...(leadUserIds?.length ? { leadUserIds } : {}) }
    }
  }

  let layout: WorkspaceViewConfig['layout']
  if (value.layout !== undefined) {
    if (!isObject(value.layout)) throw new Error('viewConfig.layout must be an object')
    assertKeys(value.layout, ['columns', 'groupBy', 'rowHeight', 'gridLines', 'frozenRows', 'frozenCols', 'zoom', 'columnWidths'], 'viewConfig.layout')
    let columns: NonNullable<WorkspaceViewConfig['layout']>['columns']
    if (value.layout.columns !== undefined) {
      if (!Array.isArray(value.layout.columns)) throw new Error('viewConfig.layout.columns must be an array')
      columns = value.layout.columns.map((column, index) => {
        if (!isObject(column)) throw new Error(`viewConfig.layout.columns[${index}] must be an object`)
        assertKeys(column, ['attributeId', 'visible', 'order'], `viewConfig.layout.columns[${index}]`)
        const attributeId = readIdentifier(column.attributeId, `viewConfig.layout.columns[${index}].attributeId`)
        const order = readInteger(column.order, `viewConfig.layout.columns[${index}].order`, 0, 1000)
        if (!attributeId || order === undefined || typeof column.visible !== 'boolean') throw new Error(`viewConfig.layout.columns[${index}] is invalid`)
        return { attributeId, visible: column.visible, order }
      })
    }
    let columnWidths: Record<string, number> | undefined
    if (value.layout.columnWidths !== undefined) {
      if (!isObject(value.layout.columnWidths)) throw new Error('viewConfig.layout.columnWidths must be an object')
      columnWidths = Object.fromEntries(Object.entries(value.layout.columnWidths).map(([attributeId, width]) => [
        readIdentifier(attributeId, `viewConfig.layout.columnWidths.${attributeId}`)!,
        readInteger(width, `viewConfig.layout.columnWidths.${attributeId}`, 50, 500)!,
      ]))
    }
    const rowHeight = value.layout.rowHeight
    if (rowHeight !== undefined && rowHeight !== 'compact' && rowHeight !== 'comfortable' && rowHeight !== 'tall') throw new Error('viewConfig.layout.rowHeight is invalid')
    if (value.layout.gridLines !== undefined && typeof value.layout.gridLines !== 'boolean') throw new Error('viewConfig.layout.gridLines is invalid')
    const groupBy = readSorts(value.layout.groupBy, 'viewConfig.layout.groupBy')
    const frozenRows = readInteger(value.layout.frozenRows, 'viewConfig.layout.frozenRows', 0, 100)
    const frozenCols = readInteger(value.layout.frozenCols, 'viewConfig.layout.frozenCols', 0, 100)
    const zoom = readInteger(value.layout.zoom, 'viewConfig.layout.zoom', 50, 200)
    layout = {
      ...(columns ? { columns } : {}),
      ...(groupBy ? { groupBy } : {}),
      ...(rowHeight ? { rowHeight } : {}),
      ...(value.layout.gridLines !== undefined ? { gridLines: value.layout.gridLines } : {}),
      ...(frozenRows !== undefined ? { frozenRows } : {}),
      ...(frozenCols !== undefined ? { frozenCols } : {}),
      ...(zoom !== undefined ? { zoom } : {}),
      ...(columnWidths ? { columnWidths } : {}),
    }
  }

  return { ...(sorts?.length ? { sorts } : {}), ...(teamScope ? { teamScope } : {}), ...(layout ? { layout } : {}) }
}

function validateWorkspaceUrlState(value: unknown): WorkspaceUrlState {
  if (!isObject(value)) throw new Error('workspace URL state must be an object')
  assertKeys(value, ['activeViewId', 'selectedRecordId', 'viewConfig'], 'workspace URL state')
  const activeViewId = readIdentifier(value.activeViewId, 'activeViewId')
  const selectedRecordId = readIdentifier(value.selectedRecordId, 'selectedRecordId')
  const viewConfig = readViewConfig(value.viewConfig)
  return { ...(activeViewId ? { activeViewId } : {}), ...(selectedRecordId ? { selectedRecordId } : {}), ...(viewConfig ? { viewConfig } : {}) }
}

export function encodeWorkspaceUrlState(state: WorkspaceUrlState): string {
  const valid = validateWorkspaceUrlState(state)
  return btoa(JSON.stringify({ version: 1, ...valid })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function decodeWorkspaceUrlState(encoded: string | null): WorkspaceUrlState {
  if (!encoded) return {}
  try {
    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (encoded.length % 4)) % 4)
    const parsed: unknown = JSON.parse(atob(padded))
    if (!isObject(parsed) || parsed.version !== 1) return {}
    const { version: _version, ...state } = parsed
    return validateWorkspaceUrlState(state)
  } catch {
    return {}
  }
}

export function settingsPath(section: SettingsSection): string {
  return `/settings/${section}`
}

export function legacySettingsPath(tab: string | null): string {
  return settingsPath(SETTINGS_SECTIONS.includes(tab as SettingsSection) ? tab as SettingsSection : 'profile')
}

export function getWorkspaceUrlState(params: URLSearchParams): WorkspaceUrlState {
  return decodeWorkspaceUrlState(params.get(STATE_PARAM))
}

export function setWorkspaceUrlState(params: URLSearchParams, state: WorkspaceUrlState): URLSearchParams {
  // The codec owns the complete query string. Carrying unknown legacy keys
  // forward would allow a previously entered search or filter value to survive
  // a later safe navigation.
  void params
  const next = new URLSearchParams()
  const viewState = params.get('v')
  const encoded = encodeWorkspaceUrlState(state)
  if (encoded === encodeWorkspaceUrlState({})) next.delete(STATE_PARAM)
  else next.set(STATE_PARAM, encoded)
  if (viewState) next.set('v', viewState)
  return next
}
