import { expect, test } from '@playwright/test'

import type { CalendarEvent } from '@/lib/calendarTypes'

test('schedules a recurring meeting with invitees and manages its scope in Chromium', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const consoleErrors: string[] = []
  const mutationMethods: string[] = []
  let createdRequest: Record<string, unknown> | null = null
  let events: CalendarEvent[] = [{
    id: 'event-1',
    providerEventId: 'provider-event-1',
    sourceId: 'source-1',
    title: 'Customer kickoff',
    startsAt: '2026-08-24T13:00:00.000Z',
    endsAt: '2026-08-24T13:30:00.000Z',
    kind: 'timed',
    timeZone: 'America/New_York',
    status: 'confirmed',
    availability: 'busy',
    privacy: 'default',
    description: 'Review implementation plan',
    location: 'Zoom',
    webLink: null,
    meetingLink: 'https://meet.example.com/kickoff',
    providerVersion: 'v1',
    recurrenceKind: 'none',
    providerSeriesId: null,
    recurrenceRule: null,
    attendees: [],
    links: [],
    source: { id: 'source-1', name: 'Primary calendar', provider: 'google' },
  }]

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()

    if (url.pathname === '/api/calendar/orgs/org-fixture/sources') {
      return route.fulfill({ json: {
        calendar: { state: 'connected' },
        sources: [{
          id: 'source-1', provider: 'google', providerCalendarId: 'primary', name: 'Primary calendar',
          description: null, timeZone: 'America/New_York', accessRole: 'owner', isPrimary: true,
          isSelected: true, lastSyncedAt: '2026-08-23T12:00:00.000Z',
          capabilities: { recurrence: true, rsvp: true, availability: true },
          recurrenceScopes: ['this-event', 'this-and-following', 'series'],
        }],
      } })
    }
    if (url.pathname === '/api/calendar/orgs/org-fixture/events' && method === 'GET') {
      return route.fulfill({ json: { calendar: { state: 'connected' }, events, total: events.length, page: 1, limit: 200 } })
    }
    if (url.pathname === '/api/calendar/orgs/org-fixture/sources/source-1/availability' && method === 'GET') {
      return route.fulfill({ json: { availability: { state: 'available', busy: [{ sourceId: 'source-1', startsAt: '2026-08-25T13:00:00.000Z', endsAt: '2026-08-25T14:00:00.000Z' }] } } })
    }
    if (url.pathname === '/api/calendar/orgs/org-fixture/events' && method === 'POST') {
      mutationMethods.push(method)
      const body = request.postDataJSON()
      createdRequest = body
      const time = body.time
      const event: CalendarEvent = {
        id: `event-${events.length + 1}`,
        providerEventId: `provider-event-${events.length + 1}`,
        sourceId: body.sourceId,
        title: body.title,
        startsAt: time.kind === 'timed' ? time.startsAt : time.startDate,
        endsAt: time.kind === 'timed' ? time.endsAt : time.endDateExclusive,
        kind: time.kind,
        timeZone: body.timeZone ?? null,
        status: body.status ?? 'confirmed',
        availability: body.availability ?? 'busy',
        privacy: body.privacy ?? 'default',
        description: body.description ?? null,
        location: body.location ?? null,
        webLink: null,
        meetingLink: body.meetingLink ?? null,
        providerVersion: 'v1',
        recurrenceKind: body.recurrence?.kind ?? 'none',
        providerSeriesId: body.recurrence?.providerSeriesId ?? null,
        recurrenceRule: body.recurrence?.recurrenceRule ?? null,
        attendees: body.attendees ?? [],
        links: body.links ?? [],
        source: { id: 'source-1', name: 'Primary calendar', provider: 'google' },
      }
      events = [...events, event]
      return route.fulfill({ status: 201, json: { event } })
    }
    if (url.pathname.startsWith('/api/calendar/orgs/org-fixture/events/') && method === 'PATCH') {
      mutationMethods.push(method)
      const eventId = url.pathname.split('/').at(-1)
      const body = request.postDataJSON()
      const current = events.find((event) => event.id === eventId)
      if (!current) return route.fulfill({ status: 404, json: { error: 'Event not found' } })
      const time = body.patch.time
      const event: CalendarEvent = {
        ...current,
        ...body.patch,
        startsAt: time ? (time.kind === 'timed' ? time.startsAt : time.startDate) : current.startsAt,
        endsAt: time ? (time.kind === 'timed' ? time.endsAt : time.endDateExclusive) : current.endsAt,
        kind: time?.kind ?? current.kind,
        providerVersion: `v${Number(current.providerVersion?.slice(1) ?? 1) + 1}`,
      }
      delete (event as CalendarEvent & { time?: unknown }).time
      events = events.map((item) => item.id === eventId ? event : item)
      return route.fulfill({ json: { event } })
    }
    if (url.pathname.startsWith('/api/calendar/orgs/org-fixture/events/') && method === 'DELETE') {
      mutationMethods.push(method)
      const eventId = url.pathname.split('/').at(-1)
      events = events.filter((event) => event.id !== eventId)
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === '/api/orgs/org-fixture/objects') return route.fulfill({ json: { objects: [] } })
    if (url.pathname === '/api/orgs/org-fixture/members') return route.fulfill({ json: { members: [], total: 0, page: 1, limit: 200 } })
    return route.fulfill({ status: 404, json: { error: `Unhandled fixture request: ${url.pathname}` } })
  })

  await page.goto('/__fixtures/calendar-workspace')
  await expect(page.getByRole('heading', { name: /^Calendar/, level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Customer kickoff,/ })).toBeVisible()

  await page.getByRole('button', { name: 'Create event on August 25, 2026' }).click()
  await page.getByLabel('Title').fill('Planning review')
  await page.getByRole('button', { name: 'Edit details' }).click()
  await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Planning review')
  await page.getByLabel('Start time').fill('10:15')
  await page.getByLabel('Location').fill('Conference room 2')
  await page.getByLabel('Description').fill('Review launch readiness')
  await page.getByLabel('Meeting link').fill('https://meet.example.com/planning')
  await page.getByLabel('Guests').fill('guest@example.com')
  await page.getByLabel('Repeat event').click()
  await page.getByRole('option', { name: 'Weekly' }).click()
  await page.getByRole('button', { name: 'Find a time' }).click()
  await page.locator('[aria-label="Available times"] button').first().click()
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByRole('button', { name: /^Planning review,/ })).toBeVisible()
  expect(createdRequest).toMatchObject({
    attendees: [{ email: 'guest@example.com', response: 'needs-action' }],
    recurrence: { kind: 'series', recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=TU' },
  })

  await page.getByRole('button', { name: /^Planning review,/ }).click()
  await expect(page.getByText('Open meeting link')).toBeVisible()
  await expect(page.getByText('guest@example.com')).toBeVisible()
  await page.getByRole('button', { name: 'Edit event' }).click()
  await page.getByLabel('Title').fill('Planning review updated')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('button', { name: /^Planning review updated,/ })).toBeVisible()

  const eventCard = page.getByRole('button', { name: /^Planning review updated,/ }).locator('..')
  await eventCard.dragTo(page.locator('section[aria-label="Wednesday, August 26"]'))
  await expect(page.getByRole('heading', { name: 'Move recurring event' })).toBeVisible()
  await page.getByRole('button', { name: 'Move events' }).click()
  await expect(page.locator('section[aria-label="Wednesday, August 26"]')).toContainText('Planning review updated')
  await page.getByRole('button', { name: 'Resize Planning review updated' }).press('ArrowDown')
  await expect(page.getByRole('heading', { name: 'Resize recurring event' })).toBeVisible()
  await page.getByRole('button', { name: 'Resize events' }).click()
  await expect.poll(() => {
    const event = events.find((item) => item.title === 'Planning review updated')
    return event ? (new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000 : null
  }).toBe(45)

  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'test-results/mai-424-calendar-scheduling-collaboration.png', fullPage: true })
  await page.getByRole('button', { name: /^Planning review updated,/ }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete event' }).click()
  await expect(page.getByRole('button', { name: /^Planning review updated,/ })).toHaveCount(0)

  expect(mutationMethods).toEqual(['POST', 'PATCH', 'PATCH', 'PATCH', 'DELETE'])
  expect(consoleErrors).toEqual([])
})
