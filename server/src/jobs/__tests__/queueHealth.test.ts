import { beforeEach, describe, expect, it, vi } from 'vitest'

const boss = vi.hoisted(() => ({
  instance: {
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    createQueue: vi.fn(),
    getQueue: vi.fn(),
  },
  constructor: vi.fn(function PgBossMock() {
    return boss.instance
  }),
}))

vi.mock('pg-boss', () => ({ PgBoss: boss.constructor }))
vi.mock('../../../dependencies/axiom.js', () => ({
  emitAxiomEvents: vi.fn(),
  isAxiomIngestConfigured: vi.fn(() => false),
}))

import {
  SYNC_JOB_NAMES,
  collectSyncQueueHealth,
  startQueue,
  stopQueue,
  syncDeadLetterQueueName,
} from '../queue.js'

beforeEach(() => {
  vi.clearAllMocks()
  boss.instance.getQueue.mockImplementation(async (name: string) => ({
    name,
    readyCount: name.endsWith('-dead-letter') ? 0 : 4,
    queuedCount: name.endsWith('-dead-letter') ? 2 : 4,
    failedCount: name.endsWith('-dead-letter') ? 0 : 1,
  }))
})

describe('sync queue health', () => {
  it('creates a dedicated dead-letter queue for every F-job queue', async () => {
    await startQueue()

    for (const queue of SYNC_JOB_NAMES) {
      const deadLetter = syncDeadLetterQueueName(queue)
      expect(boss.instance.createQueue).toHaveBeenCalledWith(deadLetter, { retryLimit: 0 })
      expect(boss.instance.createQueue).toHaveBeenCalledWith(
        queue,
        expect.objectContaining({ deadLetter }),
      )
    }

    await stopQueue()
  })

  it('reports queue depth, retained failures, and dead-letter count per queue', async () => {
    const result = await collectSyncQueueHealth(boss.instance as never)

    expect(result).toHaveLength(4)
    expect(result[0]).toMatchObject({ queueDepth: 4, failureCount: 1, deadLetterCount: 2 })
  })
})
