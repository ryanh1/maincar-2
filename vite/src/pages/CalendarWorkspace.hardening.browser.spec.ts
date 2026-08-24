import { expect, test } from '@playwright/test'

import type { CalendarEvent } from '@/lib/calendarTypes'

test('recovers across connection, provider, sync, write, timezone, and compact-layout boundaries', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let connected = false
  let provider: 'google' | 'microsoft' = 'google'
  let recoveredRefresh = true
  let conflictNextUpdate = true

  const eventFor = (): CalendarEvent => ({
    id: 'event-1', providerEventId: 'provider-event-1', sourceId: `source-${provider}`,
    title: 'Provider review', startsAt: '2026-08-24T00:30:00.000Z', endsAt: '2026-08-24T01:00:00.000Z',
    kind: 'timed', timeZone: 'Asia/Tokyo', status: 'confirmed', availability: 'busy', privacy: 'default',
    description: null, location: null, webLink: null, meetingLink: null, providerVersion: 'v1',
    recurrenceKind: 'none', providerSeriesId: null, recurrenceRule: null, attendees: [], links: [],
    source: { id: `source-${provider}`, name: `${provider === 'google' ? 'Google' : 'Microsoft'} primary`, provider },
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const sourceId = `source-${provider}`

    if (url.pathname === '/api/calendar/orgs/org-fixture/sources' && method === 'GET') {
      return route.fulfill({ json: connected ? {
        calendar: { state: 'connected' },
        sources: [{
          id: sourceId, provider, providerCalendarId: 'primary', name: `${provider === 'google' ? 'Google' : 'Microsoft'} primary`,
          description: null, timeZone: 'Asia/Tokyo', accessRole: 'owner', isPrimary: true, isSelected: true,
          lastSyncedAt: '2026-08-24T00:00:00.000Z', capabilities: { recurrence: true, rsvp: true, availability: provider === 'google' },
          recurrenceScopes: provider === 'google' ? ['this-event', 'this-and-following', 'series'] : ['this-event', 'series'],
        }],
      } : { calendar: { state: 'not-connected' }, sources: [] } })
    }
    if (url.pathname === '/api/calendar/orgs/org-fixture/events' && method === 'GET') {
      const allDay: CalendarEvent = {
        ...eventFor(), id: 'all-day-1', providerEventId: 'provider-all-day', title: 'Provider holiday',
        startsAt: '2026-08-24T00:00:00.000Z', endsAt: '2026-08-25T00:00:00.000Z', kind: 'all-day', timeZone: null,
      }
      return route.fulfill({ json: { calendar: { state: 'connected' }, events: [eventFor(), allDay], total: 2, page: 1, limit: 50 } })
    }
    if (url.pathname === `/api/calendar/orgs/org-fixture/sources/${sourceId}/sync` && method === 'POST') {
      const recovered = recoveredRefresh
      recoveredRefresh = false
      return route.fulfill({ json: { sync: { events: 2, nextCursor: 'fresh', recovered } } })
    }
    if (url.pathname === '/api/calendar/orgs/org-fixture/events/event-1' && method === 'PATCH') {
      if (conflictNextUpdate) {
        conflictNextUpdate = false
        return route.fulfill({ status: 409, json: { error: 'Calendar changed this event.', code: 'calendar_version_conflict' } })
      }
      return route.fulfill({ json: { event: eventFor() } })
    }
    if (url.pathname === '/api/calendar/orgs/org-fixture/events' && method === 'POST') {
      return route.fulfill({ status: 502, json: {
        error: 'Google saved this event, but Maincar could not refresh it. Refresh Calendar before trying again.',
        code: 'calendar_projection_stale',
      } })
    }
    if (url.pathname === `/api/calendar/orgs/org-fixture/sources/${sourceId}/availability` && method === 'GET') {
      return route.fulfill({ json: { availability: provider === 'google'
        ? { state: 'available', busy: [] }
        : { state: 'unavailable', reason: 'Availability is not available for this connected Microsoft account. Choose a time manually.' } } })
    }
    if (url.pathname === '/api/orgs/org-fixture/objects') return route.fulfill({ json: { objects: [] } })
    if (url.pathname === '/api/orgs/org-fixture/members') return route.fulfill({ json: { members: [], total: 0, page: 1, limit: 200 } })
    return route.fulfill({ status: 404, json: { error: `Unhandled fixture request: ${method} ${url.pathname}` } })
  })

  await page.goto('/__fixtures/calendar-workspace?timeZone=Asia/Tokyo')
  await expect(page.getByRole('heading', { name: 'Connect Calendar' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute('href', '/settings/integrations')

  connected = true
  await page.reload()
  await expect(page.getByRole('button', { name: 'Provider review, Aug 24, 2026, 9:30 AM GMT+9' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Provider holiday, All day, Aug 24, 2026' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show week view' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.getByRole('button', { name: 'Refresh calendar' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Calendar recovered from stale provider sync state.')).toBeVisible()

  await page.getByRole('button', { name: /^Provider review,/ }).click()
  await page.getByRole('button', { name: 'Edit event' }).click()
  await page.getByLabel('Title').fill('Provider review revised')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit event' })).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Provider review revised')
  await expect(page.getByText('Event changed in Calendar. Refreshing the latest version.')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Create event on August 24, 2026' }).click()
  await page.getByLabel('Title').fill('Projection recovery')
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByRole('dialog', { name: 'Quick create event' })).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Projection recovery')
  await expect(page.getByText('Could not create the event. The provider saved the change. Refresh Calendar before trying again.')).toBeVisible()
  await page.keyboard.press('Escape')

  connected = false
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Connect Calendar' })).toBeVisible()

  provider = 'microsoft'
  connected = true
  await page.reload()
  await expect(page.getByText('Microsoft primary')).toBeVisible()
  await page.getByRole('button', { name: /^Provider review,/ }).click()
  await page.getByRole('button', { name: 'Edit event' }).click()
  await page.getByRole('button', { name: 'Find a time' }).click()
  await expect(page.getByText('Availability is not available for this connected Microsoft account. Choose a time manually.')).toBeVisible()
})
