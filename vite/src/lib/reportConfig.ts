import type { ReportConfig } from './reportTypes'

/** A pivot needs one grouping dimension and the Amount measure before it can run. */
export function isRunnablePivot(config: ReportConfig): boolean {
  return config.rows.length + config.columns.length > 0 && config.values.length === 1
}
