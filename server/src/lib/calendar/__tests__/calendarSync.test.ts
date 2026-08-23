import { describe, expect, it, vi } from 'vitest'

import type { CalendarProvider } from '../CalendarProvider.js'
import { syncCalendarSource } from '../calendarSync.js'

function provider(): CalendarProvider {
  return {
    provider: 'google',
    capabilities: { calendarInventory: true, eventRead: true, eventWrite: true, recurrence: true, rsvp: true, availability: true, eventVersioning: true },
    listCalendars: vi.fn(),
    getCalendar: vi.fn(),
    listEvents: vi.fn(),
    getEvent: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    respondToEvent: vi.fn(),
    getAvailability: vi.fn(),
  }
}

describe('syncCalendarSource', () => {
  it('does not call a provider for a source outside the supplied tenant scope', async () => {
    const calendarProvider = provider()
    const db = {
      calendarSource: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as Parameters<typeof syncCalendarSource>[2]

    await expect(syncCalendarSource({ orgId: 'other-org', userId: 'other-user', connectionId: 'other-connection', sourceId: 'other-source' }, calendarProvider, db)).resolves.toBeNull()

    expect(calendarProvider.listEvents).not.toHaveBeenCalled()
  })
})
