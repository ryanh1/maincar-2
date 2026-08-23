import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetCalendarSourcesMock, useGetCalendarEventsMock, useUpdateCalendarSourceMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCalendarSourcesMock: vi.fn(),
  useGetCalendarEventsMock: vi.fn(),
  useUpdateCalendarSourceMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/calendar', () => ({
  useGetCalendarSources: useGetCalendarSourcesMock,
  useGetCalendarEvents: useGetCalendarEventsMock,
  useUpdateCalendarSource: useUpdateCalendarSourceMock,
}))

import { CalendarWorkspace } from './CalendarWorkspace'

const source = { id: 'primary', name: 'Main calendar', isPrimary: true, isSelected: true, provider: 'google', providerCalendarId: 'main', description: null, timeZone: 'America/New_York', accessRole: 'owner', lastSyncedAt: null }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-1' }, user: { timeZone: 'America/New_York' } })
  useGetCalendarSourcesMock.mockReturnValue({ data: { calendar: { state: 'connected' }, sources: [source] }, isLoading: false, isError: false })
  useGetCalendarEventsMock.mockReturnValue({ data: { calendar: { state: 'connected' }, events: [{ id: 'event-1', title: 'Discovery call', sourceId: 'primary', startsAt: '2026-08-23T13:00:00.000Z', endsAt: '2026-08-23T13:30:00.000Z', kind: 'timed', timeZone: 'America/New_York', status: 'confirmed' }], total: 1 }, isLoading: false, isError: false })
  useUpdateCalendarSourceMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
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
})
