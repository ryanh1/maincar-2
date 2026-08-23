import { beforeEach, describe, expect, it, vi } from 'vitest'

const queue = vi.hoisted(() => ({ sendJob: vi.fn() }))
vi.mock('../queue.js', () => ({
  JOB_MAIL_SYNC: 'mail-sync',
  sendJob: queue.sendJob,
}))

import { queuePushMailSync } from '../mailPushSubscriptions.js'

describe('queuePushMailSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queue.sendJob.mockResolvedValue('push-job-1')
  })

  it('immediately queues the existing keyed mail-sync job for the pushed mailbox', async () => {
    await queuePushMailSync('mailbox_1')

    expect(queue.sendJob).toHaveBeenCalledWith(
      'mail-sync',
      { mailAccountId: 'mailbox_1' },
      { singletonKey: 'mailbox_1', retryLimit: 3 },
    )
  })
})
