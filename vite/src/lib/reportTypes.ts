/** A stored, live-resolved team scope for owner-backed reports. */
export interface OwnerTeamScope {
  teamIds?: string[]
  leadUserIds?: string[]
}

export type DealPivotDimension = 'owner' | 'stage'

/** The interactive Deals pivot shape. */
export interface ReportConfig {
  baseObject: 'deal'
  rows: Array<{ field: DealPivotDimension }>
  columns: Array<{ field: DealPivotDimension }>
  values: Array<{ field: 'amountMinor'; aggregation: 'sum' }>
  timeZone: { mode: 'viewer' }
  filters?: { ownerTeam: OwnerTeamScope }
}

/** A saved report returned by the reports lifecycle API. */
export interface SavedReport {
  id: string
  name: string
  kind: string
  config: ReportConfig
  createdAt: string
  updatedAt: string
}

export interface GetReportsResponse {
  reports: SavedReport[]
  total: number
  page: number
  limit: number
}

export interface ReportResponse {
  report: SavedReport
}

export interface RunReportResponse {
  report: {
    rows: Array<{
      ownerId?: string
      ownerName?: string
      stageId?: string
      stageName?: string
      amountMinor: string
    }>
  }
}
