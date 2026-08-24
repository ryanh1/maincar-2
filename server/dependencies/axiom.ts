import {
  AXIOM_CONTROL_TOKEN,
  AXIOM_DATASET,
  AXIOM_FAILED_JOB_THRESHOLD,
  AXIOM_INGEST_TOKEN,
  AXIOM_NOTIFIER_IDS,
  AXIOM_URL,
} from '../src/config.js'

export interface AxiomEvent {
  time: string
  event: string
  [key: string]: boolean | number | string | null
}

export const SYNC_JOB_FAILURE_MONITOR_NAME = 'Maincar sync job failures (10m)'
export const SYNC_JOB_FAILURE_WINDOW_MINUTES = 10

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function datasetAplName(): string {
  return `['${AXIOM_DATASET.replaceAll("'", "''")}']`
}

export function isAxiomIngestConfigured(): boolean {
  return Boolean(AXIOM_DATASET && AXIOM_INGEST_TOKEN)
}

/** Send one batch to Axiom. The caller decides whether telemetry failure is fatal. */
export async function emitAxiomEvents(
  events: AxiomEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!isAxiomIngestConfigured() || events.length === 0) return false

  const response = await fetchImpl(`${AXIOM_URL}/v1/ingest/${encodeURIComponent(AXIOM_DATASET)}`, {
    method: 'POST',
    headers: bearer(AXIOM_INGEST_TOKEN),
    body: JSON.stringify(events),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Axiom ingest failed with HTTP ${response.status}.`)
  return true
}

export function syncJobFailureMonitorDefinition() {
  return {
    name: SYNC_JOB_FAILURE_MONITOR_NAME,
    description: `Alerts when more than ${AXIOM_FAILED_JOB_THRESHOLD} sync jobs fail in 10 minutes.`,
    type: 'Threshold',
    aplQuery: `${datasetAplName()}\n| where event == "job.run" and jobFamily == "sync" and outcome == "failed"\n| summarize failedJobs=count() by queue`,
    columnName: 'failedJobs',
    operator: 'Above',
    threshold: AXIOM_FAILED_JOB_THRESHOLD,
    intervalMinutes: 5,
    rangeMinutes: SYNC_JOB_FAILURE_WINDOW_MINUTES,
    notifierIds: AXIOM_NOTIFIER_IDS,
    notifyByGroup: true,
    notifyEveryRun: false,
    alertOnNoData: false,
    disabled: false,
    resolvable: true,
    skipResolved: false,
    secondDelay: 0,
    tolerance: 0,
    triggerAfterNPositiveResults: 1,
    triggerFromNRuns: 1,
  } as const
}

/** Idempotently create the standard failed-job monitor when control credentials exist. */
export async function ensureSyncJobFailureMonitor(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!AXIOM_DATASET || !AXIOM_CONTROL_TOKEN || AXIOM_NOTIFIER_IDS.length === 0) return false

  const list = await fetchImpl(`${AXIOM_URL}/v2/monitors`, {
    headers: bearer(AXIOM_CONTROL_TOKEN),
    signal: AbortSignal.timeout(10_000),
  })
  if (!list.ok) throw new Error(`Axiom monitor lookup failed with HTTP ${list.status}.`)
  const payload = await list.json() as unknown
  const monitors = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === 'object' && Array.isArray((payload as { monitors?: unknown }).monitors)
      ? (payload as { monitors: unknown[] }).monitors
      : [])
  if (monitors.some((monitor) => (
    monitor && typeof monitor === 'object' && (monitor as { name?: unknown }).name === SYNC_JOB_FAILURE_MONITOR_NAME
  ))) return false

  const created = await fetchImpl(`${AXIOM_URL}/v2/monitors`, {
    method: 'POST',
    headers: bearer(AXIOM_CONTROL_TOKEN),
    body: JSON.stringify(syncJobFailureMonitorDefinition()),
    signal: AbortSignal.timeout(10_000),
  })
  if (!created.ok) throw new Error(`Axiom monitor creation failed with HTTP ${created.status}.`)
  return true
}
