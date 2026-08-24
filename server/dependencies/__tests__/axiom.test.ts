import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config.js', () => ({
  AXIOM_URL: 'https://api.axiom.test',
  AXIOM_DATASET: 'maincar-events',
  AXIOM_INGEST_TOKEN: 'ingest-token',
  AXIOM_CONTROL_TOKEN: 'control-token',
  AXIOM_NOTIFIER_IDS: ['notifier-1'],
  AXIOM_FAILED_JOB_THRESHOLD: 5,
}))

import {
  SYNC_JOB_FAILURE_MONITOR_NAME,
  emitAxiomEvents,
  ensureSyncJobFailureMonitor,
} from '../axiom.js'

describe('Axiom observability adapter', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ingests a batch with the least-privilege worker token', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    const events = [{ time: '2026-08-24T00:00:00.000Z', event: 'job.run', queue: 'mail-sync' }]

    await expect(emitAxiomEvents(events, fetchMock)).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.axiom.test/v1/ingest/maincar-events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer ingest-token' }),
        body: JSON.stringify(events),
      }),
    )
  })

  it('creates the standard grouped failure monitor once', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'monitor-1' }), { status: 200 }))

    await expect(ensureSyncJobFailureMonitor(fetchMock)).resolves.toBe(true)

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(body).toMatchObject({
      name: SYNC_JOB_FAILURE_MONITOR_NAME,
      threshold: 5,
      rangeMinutes: 10,
      notifyByGroup: true,
      notifierIds: ['notifier-1'],
    })
    expect(body.aplQuery).toContain('outcome == "failed"')
    expect(body.aplQuery).toContain('summarize failedJobs=count() by queue')
  })
})
