import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureSettings } from '../../lib/captureExclusions.js'

const db = vi.hoisted(() => ({
  email: { findMany: vi.fn(), updateMany: vi.fn() },
  meeting: { findMany: vi.fn(), updateMany: vi.fn() },
  activityLink: { findMany: vi.fn(), deleteMany: vi.fn() },
  activityEntry: { deleteMany: vi.fn(), findFirst: vi.fn() },
  person: { updateMany: vi.fn() },
  company: { updateMany: vi.fn() },
  deal: { updateMany: vi.fn() },
  auditLog: { upsert: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: db }))

const queue = vi.hoisted(() => ({ workJob: vi.fn() }))
vi.mock('../queue.js', () => ({
  JOB_CAPTURE_PURGE: 'capture-purge',
  workJob: queue.workJob,
}))

import { capturePurgeJob, registerCapturePurgeWorker } from '../capturePurge.js'

const SETTINGS: CaptureSettings = {
  internalDomains: [],
  allowDomains: [],
  excludeDomains: [],
  excludeAddresses: ['support@ourco.com'],
  excludeRoleAddresses: true,
  dropBulkInbound: true,
  bulkInboundMax: 15,
  subjectExcludes: [],
  logActivityTypes: 'both',
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (callback) => callback(db))
  db.email.findMany.mockResolvedValue([])
  db.meeting.findMany.mockResolvedValue([])
  db.activityLink.findMany.mockResolvedValue([])
  db.email.updateMany.mockResolvedValue({ count: 1 })
  db.meeting.updateMany.mockResolvedValue({ count: 1 })
  db.activityLink.deleteMany.mockResolvedValue({ count: 0 })
  db.activityEntry.deleteMany.mockResolvedValue({ count: 0 })
  db.activityEntry.findFirst.mockResolvedValue(null)
  db.auditLog.upsert.mockResolvedValue({ id: 'audit_1' })
})

describe('capturePurgeJob', () => {
  it('soft-deletes stored activities newly excluded by an address rule, removes timeline rows, recomputes links, and writes one grouped audit entry', async () => {
    db.email.findMany.mockResolvedValue([
      {
        id: 'email_1',
        orgId: 'org_1',
        subject: 'Ticket update',
        direction: 'inbound',
        sentAt: new Date('2026-08-23T12:00:00.000Z'),
        receivedAt: null,
        createdAt: new Date('2026-08-23T12:00:00.000Z'),
        participants: [{ address: 'support@ourco.com' }],
      },
    ])
    db.activityLink.findMany.mockResolvedValue([
      { sourceType: 'email', sourceId: 'email_1', targetType: 'person', targetId: 'person_1' },
      { sourceType: 'email', sourceId: 'email_1', targetType: 'company', targetId: 'company_1' },
    ])

    await expect(capturePurgeJob({ orgId: 'org_1', ruleId: 'settings_1:version_1', actorId: 'admin_1', settings: SETTINGS })).resolves.toEqual({ emails: 1, meetings: 0 })

    expect(db.email.updateMany).toHaveBeenCalledWith({
      where: { id: 'email_1', orgId: 'org_1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(db.activityEntry.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org_1', sourceType: 'email', sourceId: 'email_1' } })
    expect(db.activityLink.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org_1', sourceType: 'email', sourceId: 'email_1' } })
    expect(db.person.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org_1', id: 'person_1' },
      data: { activityCount: { decrement: 1 }, lastContactedAt: null },
    })
    expect(db.company.updateMany).toHaveBeenCalledWith({ where: { orgId: 'org_1', id: 'company_1' }, data: { activityCount: { decrement: 1 } } })
    expect(db.auditLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId_batchId: { orgId: 'org_1', batchId: 'settings_1:version_1' } },
      create: expect.objectContaining({ actorId: 'admin_1', action: 'capture_purge', objectType: 'capture_settings', objectId: 'settings_1:version_1' }),
    }))
  })

  it('does not resurrect or re-purge already soft-deleted activity on retry', async () => {
    db.email.findMany.mockResolvedValue([])

    await expect(capturePurgeJob({ orgId: 'org_1', ruleId: 'settings_1:version_1', actorId: 'admin_1', settings: SETTINGS })).resolves.toEqual({ emails: 0, meetings: 0 })

    expect(db.email.updateMany).not.toHaveBeenCalled()
    expect(db.activityEntry.deleteMany).not.toHaveBeenCalled()
    expect(db.auditLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ diffJson: { emails: 0, meetings: 0 } }),
    }))
  })
})

describe('registerCapturePurgeWorker', () => {
  it('subscribes to the capture-purge queue and sends each job to the purge handler', async () => {
    queue.workJob.mockResolvedValue('worker_1')

    await registerCapturePurgeWorker()

    expect(queue.workJob).toHaveBeenCalledWith('capture-purge', { batchSize: 1 }, expect.any(Function))
  })
})
