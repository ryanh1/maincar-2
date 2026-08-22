/** A stored, live-resolved team scope for owner-backed reports. */
export interface OwnerTeamScope {
  teamIds?: string[]
  leadUserIds?: string[]
}

export type DealPivotDimension = 'owner' | 'stage' | 'createdAt'
export type PivotValueTransform = 'none' | 'percentOfGrandTotal' | 'percentOfColumn' | 'percentOfRow' | 'percentOfParent' | 'runningTotal' | 'rankLargestToSmallest'
export type PeriodComparison = 'previousPeriod' | 'samePeriodLastYear'

export type ReportChartType = 'bar' | 'line' | 'area' | 'pie' | 'funnel' | 'heatmap' | 'scatter' | 'kpi'
export type ReportChartColor = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4'

/** Display-only chart settings. The report query remains the pivot configuration above. */
export interface ReportChartConfig {
  type: ReportChartType
  color: ReportChartColor
  labels: boolean
  yAxisMax?: number
}

/** One exact dimension value behind a pivot cell. */
export interface DealDrillFilter {
  field: DealPivotDimension
  value: string
  label: string
}

/** The CRM records represented by a selected pivot value. */
export interface ReportDrillSelection {
  filters: DealDrillFilter[]
}

/** The interactive Deals pivot shape. */
export interface ReportConfig {
  baseObject: 'deal'
  rows: Array<{ field: DealPivotDimension }>
  columns: Array<{ field: DealPivotDimension }>
  values: Array<{ field: 'amountMinor'; aggregation: 'sum'; showAs?: PivotValueTransform }>
  timeZone: { mode: 'viewer' }
  timeBucket?: { field: 'createdAt'; grain: 'day' }
  filters?: { ownerTeam: OwnerTeamScope }
  compareTo?: PeriodComparison
  summaryRows?: Array<{ rowKey: string; showAs: 'percentOfGrandTotal' | 'percentOfParent' | 'samePeriodLastYear' }>
  chart?: ReportChartConfig
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
      createdDay?: string
      amountMinor: string
    }>
  }
}
