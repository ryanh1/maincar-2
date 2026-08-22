import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, withProviders } from '@/test/utils'

const { useAuthMock, useGetVoicemailsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetVoicemailsMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/voicemails', () => ({ useGetVoicemails: useGetVoicemailsMock }))

import { Voicemails } from '@/pages/Voicemails'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function voicemailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'voicemail-1', fromE164: '+12015550111', durationS: 73,
    transcriptStatus: 'done', transcript: 'Please call me back.',
    createdAt: '2026-08-01T12:00:00.000Z', ...overrides,
  }
}

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: { voicemails: [voicemailRow()], total: 1, page: 1, limit: 25 },
    isPending: false, isError: false, refetch: vi.fn(), ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' }, org: ORG })
  useGetVoicemailsMock.mockReturnValue(queryState())
})

describe('the voicemail inbox', () => {
  it('shows the caller, duration, transcript, and zone-labelled received time', () => {
    renderWithProviders(<Voicemails />)

    expect(screen.getByText('+12015550111')).toBeInTheDocument()
    expect(screen.getByText('01:13')).toBeInTheDocument()
    expect(screen.getByText('Please call me back.')).toBeInTheDocument()
    expect(screen.getByText('Aug 1, 2026, 8:00 AM EDT')).toBeInTheDocument()
  })

  it('calls out a pending transcript and links the row to its detail route', () => {
    useGetVoicemailsMock.mockReturnValue(queryState({
      data: { voicemails: [voicemailRow({ transcriptStatus: 'pending', transcript: null })], total: 1, page: 1, limit: 25 },
    }))
    renderWithProviders(<Voicemails />)

    expect(screen.getByText('Transcribing…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+12015550111' })).toHaveAttribute('href', '/voicemails/voicemail-1')
  })

  it('uses URL state for caller search and pagination', async () => {
    const user = userEvent.setup()
    useGetVoicemailsMock.mockReturnValue(queryState({
      data: { voicemails: [voicemailRow()], total: 60, page: 1, limit: 25 },
    }))
    renderWithProviders(<Voicemails />, { initialEntries: ['/voicemails?page=1'] })

    await user.type(screen.getByLabelText('Search voicemails by caller number'), '201')
    await waitFor(() => expect(useGetVoicemailsMock).toHaveBeenLastCalledWith('org-a', {
      page: 1, limit: 25, q: '201',
    }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(useGetVoicemailsMock).toHaveBeenLastCalledWith('org-a', {
      page: 2, limit: 25, q: '201',
    }))
  })

  it('shows loading, an actionable error, and the exact empty state', async () => {
    useGetVoicemailsMock.mockReturnValue(queryState({ data: undefined, isPending: true }))
    const { rerender } = renderWithProviders(<Voicemails />)
    expect(screen.getByLabelText('Loading voicemails')).toBeInTheDocument()

    const refetch = vi.fn()
    useGetVoicemailsMock.mockReturnValue(queryState({ data: undefined, isError: true, refetch }))
    rerender(withProviders(<Voicemails />))
    expect(screen.getByText('Could not load voicemails.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()

    useGetVoicemailsMock.mockReturnValue(queryState({ data: { voicemails: [], total: 0, page: 1, limit: 25 } }))
    rerender(withProviders(<Voicemails />))
    expect(screen.getByText('No voicemails')).toBeInTheDocument()
  })
})
