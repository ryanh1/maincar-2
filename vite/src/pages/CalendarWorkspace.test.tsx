import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetCalendarSourcesMock, useGetCalendarEventsMock, useGetCalendarAvailabilityMock, useUpdateCalendarSourceMock, useCreateCalendarEventMock, useUpdateCalendarEventMock, useDeleteCalendarEventMock, useRespondToCalendarEventMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCalendarSourcesMock: vi.fn(),
  useGetCalendarEventsMock: vi.fn(),
  useGetCalendarAvailabilityMock: vi.fn(),
  useUpdateCalendarSourceMock: vi.fn(),
  useCreateCalendarEventMock: vi.fn(),
  useUpdateCalendarEventMock: vi.fn(),
  useDeleteCalendarEventMock: vi.fn(),
  useRespondToCalendarEventMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/components/editor/useMentionSuggestions', () => ({
  useMentionSuggestions: () => ({
    isPending: false,
    items: [{ id: 'company-1', label: 'Acme', kind: 'company', detail: 'Company' }],
  }),
}))
vi.mock('@/hooks/calendar', () => ({
  useGetCalendarSources: useGetCalendarSourcesMock,
  useGetCalendarEvents: useGetCalendarEventsMock,
  useGetCalendarAvailability: useGetCalendarAvailabilityMock,
  useUpdateCalendarSource: useUpdateCalendarSourceMock,
  useCreateCalendarEvent: useCreateCalendarEventMock,
  useUpdateCalendarEvent: useUpdateCalendarEventMock,
  useDeleteCalendarEvent: useDeleteCalendarEventMock,
  useRespondToCalendarEvent: useRespondToCalendarEventMock,
}))

import { CalendarWorkspace } from './CalendarWorkspace'

const source = {
  id: 'primary', name: 'Main calendar', isPrimary: true, isSelected: true, provider: 'google',
  providerCalendarId: 'main', description: null, timeZone: 'America/New_York', accessRole: 'owner', lastSyncedAt: null,
  capabilities: { recurrence: true, rsvp: true, availability: true },
  recurrenceScopes: ['this-event', 'this-and-following', 'series'],
}
const calendarEvent = {
  id: 'event-1', providerEventId: 'provider-event-1', title: 'Discovery call', sourceId: 'primary',
  startsAt: '2026-08-23T13:00:00.000Z', endsAt: '2026-08-23T13:30:00.000Z', kind: 'timed',
  timeZone: 'America/New_York', status: 'confirmed', availability: 'busy', privacy: 'default', meetingLink: null,
  links: [], attendees: [], recurrenceKind: 'none', providerSeriesId: null, recurrenceRule: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-1' }, user: { email: 'rep@example.test', timeZone: 'America/New_York' } })
  useGetCalendarSourcesMock.mockReturnValue({ data: { calendar: { state: 'connected' }, sources: [source] }, isLoading: false, isError: false })
  useGetCalendarEventsMock.mockReturnValue({ data: { calendar: { state: 'connected' }, events: [calendarEvent], total: 1 }, isLoading: false, isError: false, refetch: vi.fn() })
  useGetCalendarAvailabilityMock.mockReturnValue({ data: undefined, isLoading: false, isError: false })
  useUpdateCalendarSourceMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useCreateCalendarEventMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useUpdateCalendarEventMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useDeleteCalendarEventMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useRespondToCalendarEventMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

describe('CalendarWorkspace', () => {
  it('invites the rep to connect Calendar when no source is available', () => {
    useGetCalendarSourcesMock.mockReturnValue({ data: { calendar: { state: 'not-connected' }, sources: [] }, isLoading: false, isError: false })

    renderWithProviders(<CalendarWorkspace />)

    expect(screen.getByRole('heading', { name: 'Connect Calendar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute('href', '/settings/integrations')
  })

  it('changes the view and date range while retaining the selected calendar rail', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    expect(screen.getByText('Main calendar')).toBeInTheDocument()
    expect(screen.getByText('Discovery call')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show month view' }))
    expect(screen.getByRole('heading', { name: /August 2026/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show next time range' }))
    expect(useGetCalendarEventsMock).toHaveBeenCalled()
  })

  it('selects a secondary calendar from the rail', async () => {
    const mutate = vi.fn()
    useGetCalendarSourcesMock.mockReturnValue({ data: { calendar: { state: 'connected' }, sources: [source, { ...source, id: 'team', name: 'Team calendar', isPrimary: false, isSelected: false }] }, isLoading: false, isError: false })
    useUpdateCalendarSourceMock.mockReturnValue({ mutate, isPending: false })
    const user = userEvent.setup()

    renderWithProviders(<CalendarWorkspace />)
    await user.click(screen.getByRole('button', { name: 'Team calendar' }))

    expect(mutate).toHaveBeenCalledWith({ orgId: 'org-1', sourceId: 'team', isSelected: true })
  })

  it('opens quick create from a time slot and sends the entered event to the selected calendar', async () => {
    const mutate = vi.fn()
    useCreateCalendarEventMock.mockReturnValue({ mutate, isPending: false })
    const user = userEvent.setup()

    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getAllByRole('button', { name: /Create event on/i })[0])
    expect(screen.getByRole('dialog', { name: 'Quick create event' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Title'), 'Account review')
    await user.click(screen.getByRole('button', { name: 'Create event' }))

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', sourceId: 'primary', title: 'Account review' }), expect.anything())
  })

  it('opens event details and offers a full edit path', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getByRole('button', { name: /^Discovery call,/i }))

    expect(screen.getByRole('dialog', { name: 'Discovery call' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeInTheDocument()
  })

  it('edits the complete event field set and preserves Maincar metadata', async () => {
    const mutate = vi.fn()
    useUpdateCalendarEventMock.mockReturnValue({ mutate, isPending: false })
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getByRole('button', { name: /^Discovery call,/i }))
    await user.click(screen.getByRole('button', { name: 'Edit event' }))

    expect(screen.getByLabelText('Timezone')).toHaveValue('America/New_York')
    expect(screen.getByText('Duration')).toBeInTheDocument()
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByText('Privacy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Link CRM records/ })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Meeting link'), 'https://meet.example.test/discovery')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      eventId: 'event-1',
      patch: expect.objectContaining({
        availability: 'busy',
        privacy: 'default',
        meetingLink: 'https://meet.example.test/discovery',
        timeZone: 'America/New_York',
      }),
    }), expect.anything())
  })

  it('adds guests and a provider-backed recurrence rule from the event editor', async () => {
    const mutate = vi.fn()
    useUpdateCalendarEventMock.mockReturnValue({ mutate, isPending: false })
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getByRole('button', { name: /^Discovery call,/i }))
    await user.click(screen.getByRole('button', { name: 'Edit event' }))
    await user.type(screen.getByLabelText('Guests'), 'guest@example.test')
    await user.click(screen.getByRole('combobox', { name: 'Repeat event' }))
    await user.click(screen.getByRole('option', { name: 'Weekly' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      eventId: 'event-1',
      scope: 'this-event',
      patch: expect.objectContaining({
        attendees: [{ email: 'guest@example.test', isOptional: false, isResource: false, response: 'needs-action' }],
        recurrence: expect.objectContaining({ kind: 'series', recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=SU' }),
      }),
    }), expect.anything())
  })

  it('preserves the exact provider recurrence rule when editing another field', async () => {
    const mutate = vi.fn()
    useUpdateCalendarEventMock.mockReturnValue({ mutate, isPending: false })
    useGetCalendarEventsMock.mockReturnValue({
      data: {
        calendar: { state: 'connected' },
        events: [{
          ...calendarEvent,
          recurrenceKind: 'series',
          providerSeriesId: 'series-1',
          recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=4',
        }],
        total: 1,
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getByRole('button', { name: /^Discovery call,/i }))
    await user.click(screen.getByRole('button', { name: 'Edit event' }))
    await user.type(screen.getByLabelText('Title'), ' updated')
    await user.click(screen.getByRole('combobox', { name: 'Apply changes to' }))
    await user.click(screen.getByRole('option', { name: 'All events' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'series',
      patch: expect.objectContaining({
        recurrence: expect.objectContaining({ recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=4' }),
      }),
    }), expect.anything())
  })

  it('shows guest RSVP state and responds to a recurring invitation with an explicit scope', async () => {
    const mutate = vi.fn()
    useRespondToCalendarEventMock.mockReturnValue({ mutate, isPending: false })
    useGetCalendarEventsMock.mockReturnValue({
      data: {
        calendar: { state: 'connected' },
        events: [{
          ...calendarEvent,
          recurrenceKind: 'series',
          providerSeriesId: 'series-1',
          recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=SU',
          attendees: [
            { email: 'guest@example.test', name: 'Guest', isOptional: false, isResource: false, response: 'accepted' },
            { email: 'rep@example.test', name: 'Ryan', isOptional: false, isResource: false, response: 'needs-action' },
          ],
        }],
        total: 1,
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getByRole('button', { name: /^Discovery call,/i }))

    expect(screen.getByText('guest@example.test')).toBeInTheDocument()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.getByText('Needs response')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Apply response to' }))
    await user.click(screen.getByRole('option', { name: 'All events' }))
    await user.click(screen.getByRole('button', { name: 'Accept' }))

    expect(mutate).toHaveBeenCalledWith({
      orgId: 'org-1', eventId: 'event-1', response: 'accepted', scope: 'series',
    }, expect.anything())
  })

  it('shows an honest find-a-time fallback when the provider cannot return availability', async () => {
    useGetCalendarSourcesMock.mockReturnValue({
      data: {
        calendar: { state: 'connected' },
        sources: [{
          ...source,
          provider: 'microsoft',
          capabilities: { recurrence: true, rsvp: true, availability: false },
          recurrenceScopes: ['this-event', 'series'],
        }],
      },
      isLoading: false,
      isError: false,
    })
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getByRole('button', { name: /^Discovery call,/i }))
    await user.click(screen.getByRole('button', { name: 'Edit event' }))
    await user.click(screen.getByRole('button', { name: 'Find a time' }))

    expect(screen.getByText('Availability is not available for this connected Microsoft account. Choose a time manually.')).toBeInTheDocument()
  })

  it('offers provider-backed open times and applies the selected time', async () => {
    useGetCalendarAvailabilityMock.mockReturnValue({
      data: {
        availability: {
          state: 'available',
          busy: [{ sourceId: 'primary', startsAt: '2026-08-23T13:00:00.000Z', endsAt: '2026-08-23T14:00:00.000Z' }],
        },
      },
      isLoading: false,
      isError: false,
    })
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    await user.click(screen.getByRole('button', { name: /^Discovery call,/i }))
    await user.click(screen.getByRole('button', { name: 'Edit event' }))
    await user.click(screen.getByRole('button', { name: 'Find a time' }))
    await user.click(screen.getByRole('button', { name: '10:00 AM EDT' }))

    expect(screen.getByLabelText('Start time')).toHaveValue('10:00')
  })

  it('moves an event by drag and resizes it from the accessible handle', () => {
    const mutate = vi.fn()
    useUpdateCalendarEventMock.mockReturnValue({ mutate, isPending: false })
    renderWithProviders(<CalendarWorkspace />)

    const eventButton = screen.getByRole('button', { name: /^Discovery call,/i })
    const card = eventButton.closest('[draggable="true"]')
    expect(card).not.toBeNull()
    const values = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    }
    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: 'Monday, August 24' }), { dataTransfer })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Discovery call' }), { key: 'ArrowDown' })

    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate.mock.calls[0][0]).toMatchObject({ eventId: 'event-1', patch: { time: { kind: 'timed' } } })
    expect(mutate.mock.calls[1][0]).toMatchObject({
      eventId: 'event-1',
      patch: { time: { kind: 'timed', startsAt: '2026-08-23T13:00:00.000Z', endsAt: '2026-08-23T13:45:00.000Z' } },
    })
  })

  it('asks for an explicit recurrence scope before moving a series occurrence', async () => {
    const mutate = vi.fn()
    useUpdateCalendarEventMock.mockReturnValue({ mutate, isPending: false })
    useGetCalendarEventsMock.mockReturnValue({
      data: {
        calendar: { state: 'connected' },
        events: [{ ...calendarEvent, recurrenceKind: 'series', providerSeriesId: 'series-1', recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=SU' }],
        total: 1,
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderWithProviders(<CalendarWorkspace />)

    const eventButton = screen.getByRole('button', { name: /^Discovery call,/i })
    const card = eventButton.closest('[draggable="true"]')
    const values = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    }
    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: 'Monday, August 24' }), { dataTransfer })

    expect(screen.getByRole('dialog', { name: 'Move recurring event' })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Apply change to' }))
    await user.click(screen.getByRole('option', { name: 'All events' }))
    await user.click(screen.getByRole('button', { name: 'Move events' }))

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1', scope: 'series' }), expect.anything())
  })
})
