import { describe, expect, it, vi } from 'vitest'

import { saveCalendarEventMetadata } from '../calendarEventMetadata.js'

describe('saveCalendarEventMetadata', () => {
  it('updates only the owned event and rewrites links through RecordLink in one transaction', async () => {
    const tx = {
      calendarEvent: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      recordLink: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    }
    const db = { $transaction: vi.fn((operation) => operation(tx)) }

    await saveCalendarEventMetadata({
      orgId: 'org-1',
      userId: 'user-1',
      eventId: 'event-1',
      meetingLink: 'https://meet.example.test/one',
      timeZone: 'America/New_York',
      links: [{ object: 'company', id: 'company-1' }, { object: 'person', id: 'person-1' }],
    }, db as never)

    expect(tx.calendarEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'event-1', orgId: 'org-1', userId: 'user-1' },
      data: { meetingLinkOverride: 'https://meet.example.test/one', timeZoneOverride: 'America/New_York' },
    })
    expect(tx.recordLink.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org-1', calendarEventId: 'event-1' } })
    expect(tx.recordLink.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ fromObject: 'calendar-event', fromId: 'event-1', toObject: 'company', toId: 'company-1', calendarEventId: 'event-1' }),
        expect.objectContaining({ fromObject: 'calendar-event', fromId: 'event-1', toObject: 'person', toId: 'person-1', calendarEventId: 'event-1' }),
      ],
    })
  })

  it('refuses to attach metadata when the tenant-scoped event is absent', async () => {
    const tx = {
      calendarEvent: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      recordLink: { deleteMany: vi.fn(), createMany: vi.fn() },
    }
    const db = { $transaction: vi.fn((operation) => operation(tx)) }

    await expect(saveCalendarEventMetadata({
      orgId: 'org-1',
      userId: 'user-1',
      eventId: 'foreign-event',
      meetingLink: null,
    }, db as never)).rejects.toThrow('not found')
    expect(tx.recordLink.deleteMany).not.toHaveBeenCalled()
  })
})
