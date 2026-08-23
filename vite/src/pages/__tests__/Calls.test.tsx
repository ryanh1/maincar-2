// Calls history page (MAI-39).
//
// What these protect:
//   - page, sort, dir, and q live in the URL, so a reload or a pasted link
//     restores the same view rather than dropping the reader on page one
//   - the list is paged, sorted, and searched on the SERVER — never sliced here
//   - a header click sorts and a second click flips the direction
//   - the Number links to the call's detail page (/calls/:id — MAI-40)
//   - every raw enum is shown as a label, and every time carries its zone
//   - loading, error, and empty states each render
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetCallsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCallsMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/dialer', () => ({ useGetCalls: useGetCallsMock }))

import { Calls } from '@/pages/Calls'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    direction: 'outbound',
    status: 'completed',
    fromE164: '+12015550100',
    toE164: '+12015550111',
    recordingPlanned: true,
    recordingReason: 'allowed',
    transcriptStatus: 'done',
    twilioCallSid: 'CA1',
    durationS: 73,
    startedAt: '2026-08-01T12:00:00.000Z',
    endedAt: '2026-08-01T12:01:13.000Z',
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

function callsResponse(overrides: Record<string, unknown> = {}) {
  return { calls: [callRow()], total: 1, page: 1, limit: 25, ...overrides }
}

function listState(overrides: Record<string, unknown> = {}) {
  return {
    data: callsResponse(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' }, org: ORG })
  useGetCallsMock.mockReturnValue(listState())
})

describe('the calls list', () => {
  it('renders a row with the number, the outcome and transcript LABELS, and the duration as mm:ss', () => {
    renderWithProviders(<Calls />)

    expect(screen.getByText('+12015550111')).toBeInTheDocument()
    // Never the raw enum value.
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.queryByText('done')).not.toBeInTheDocument()
    expect(screen.getByText('01:13')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Number' }).closest('tr')).toHaveClass('bg-surface')
  })

  it('links the Number to the call detail page at /calls/:id', () => {
    renderWithProviders(<Calls />)

    const link = screen.getByRole('link', { name: '+12015550111' })
    expect(link).toHaveAttribute('href', '/calls/call-1')
  })

  it('shows a dash when a call has no duration yet', () => {
    useGetCallsMock.mockReturnValue(listState({ data: callsResponse({ calls: [callRow({ durationS: null })] }) }))
    renderWithProviders(<Calls />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it("shows the When in the viewing user's timezone, with the zone named", () => {
    renderWithProviders(<Calls />)

    // 12:00 UTC is 8:00 AM in New York, and the zone label is always present.
    expect(screen.getByText(/Aug 1, 2026, 8:00 AM EDT/)).toBeInTheDocument()
  })

  it('shows a loading state while calls load', () => {
    useGetCallsMock.mockReturnValue(listState({ data: undefined, isPending: true }))
    renderWithProviders(<Calls />)

    expect(screen.queryByText('+12015550111')).not.toBeInTheDocument()
  })

  it('offers a retry when the list fails to load', async () => {
    const refetch = vi.fn()
    useGetCallsMock.mockReturnValue(
      listState({ data: undefined, isPending: false, isError: true, refetch }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Calls />)

    expect(screen.getByText('Could not load calls.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('invites the reader to act rather than explaining emptiness', () => {
    useGetCallsMock.mockReturnValue(listState({ data: callsResponse({ calls: [], total: 0 }) }))
    renderWithProviders(<Calls />)

    expect(screen.getByText('No calls yet. Place one from the dialer.')).toBeInTheDocument()
  })

  it('tells the searcher how to recover when a search matches nothing', async () => {
    useGetCallsMock.mockReturnValue(listState({ data: callsResponse({ calls: [], total: 0 }) }))
    const user = userEvent.setup()
    renderWithProviders(<Calls />)
    await user.type(screen.getByLabelText('Search calls by number'), '999')

    expect(
      screen.getByText('No call matches this number. Clear the search to see them all.'),
    ).toBeInTheDocument()
  })
})

describe('URL state', () => {
  it('asks the SERVER for safe page, sort, and direction state while ignoring a literal search', () => {
    renderWithProviders(<Calls />, {
      initialEntries: ['/calls?q=201&sort=toE164&dir=asc&page=3'],
    })

    expect(useGetCallsMock).toHaveBeenCalledWith('org-a', {
      page: 3,
      limit: 25,
      sort: 'toE164',
      dir: 'asc',
      q: undefined,
    })
  })

  it('defaults to newest first — createdAt descending — with no search', () => {
    renderWithProviders(<Calls />)

    expect(useGetCallsMock).toHaveBeenCalledWith('org-a', {
      page: 1,
      limit: 25,
      sort: 'createdAt',
      dir: 'desc',
      q: undefined,
    })
  })

  it('does not restore a literal search from the URL on reload', () => {
    renderWithProviders(<Calls />, { initialEntries: ['/calls?q=555'] })

    expect(screen.getByLabelText('Search calls by number')).toHaveValue('')
  })

  it('a header click sorts, and a second click flips the direction', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Calls />)

    await user.click(screen.getByRole('button', { name: 'Sort by Number' }))
    await waitFor(() =>
      expect(useGetCallsMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ sort: 'toE164', dir: 'asc', page: 1 }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Sort by Number' }))
    await waitFor(() =>
      expect(useGetCallsMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ sort: 'toE164', dir: 'desc' }),
      ),
    )
  })

  it('the Transcript column is not a sort control — the server cannot order by it', () => {
    renderWithProviders(<Calls />)

    expect(screen.queryByRole('button', { name: 'Sort by Transcript' })).not.toBeInTheDocument()
  })

  it('shows a Clear button only while a search is active, and clearing resets the local query', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Calls />, { initialEntries: ['/calls?page=2'] })
    await user.type(screen.getByLabelText('Search calls by number'), '555')

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() =>
      expect(useGetCallsMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ q: undefined, page: 1 }),
      ),
    )
  })

  it('shows no Clear button when there is no search', () => {
    renderWithProviders(<Calls />)

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('typing in the search updates q and returns to page one', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Calls />, { initialEntries: ['/calls?page=4'] })

    await user.type(screen.getByLabelText('Search calls by number'), '7')
    await waitFor(() =>
      expect(useGetCallsMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ q: '7', page: 1 }),
      ),
    )
  })
})

describe('pagination', () => {
  it('moves to the next page and back, driving the page param', async () => {
    useGetCallsMock.mockReturnValue(listState({ data: callsResponse({ total: 60 }) }))
    const user = userEvent.setup()
    renderWithProviders(<Calls />)

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(useGetCallsMock).toHaveBeenLastCalledWith('org-a', expect.objectContaining({ page: 2 })),
    )

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() =>
      expect(useGetCallsMock).toHaveBeenLastCalledWith('org-a', expect.objectContaining({ page: 1 })),
    )
  })

  it('hides the pager when a single page holds every call', () => {
    renderWithProviders(<Calls />)

    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })
})
