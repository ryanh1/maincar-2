/** A stored, live-resolved team scope for owner-backed reports. */
export interface OwnerTeamScope {
  teamIds?: string[]
  leadUserIds?: string[]
}

/** The first engine-supported report shape (MAI-143). */
export interface ReportConfig {
  baseObject: 'deal'
  rows: [{ field: 'stage' }]
  values: [{ field: 'amountMinor'; aggregation: 'sum' }]
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
    rows: Array<{ stageId: string; stageName: string; amountMinor: string }>
  }
}
