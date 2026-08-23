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
  backfillMonths: 3 | 6 | 12
}

export interface CaptureSettingsResponse {
  captureSettings: CaptureSettings
  optedOut: boolean
  purgeQueued?: boolean
}
