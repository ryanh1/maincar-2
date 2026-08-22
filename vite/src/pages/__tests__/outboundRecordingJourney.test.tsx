// The rep-facing end of the policy-owned recording pipeline (MAI-262).
//
// Server fixtures stand in for Twilio, storage, and Deepgram: the eligible path
// has reached its persisted `done` state with text, while the unavailable path
// has settled at `skipped-not-recorded`. The journey asserts that a rep sees the
// same honest state in Calls and after opening that call's detail page.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetCallsMock, useGetCallDetailMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCallsMock: vi.fn(),
  useGetCallDetailMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/dialer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/dialer')>()),
  useGetCalls: useGetCallsMock,
  useGetCallDetail: useGetCallDetailMock,
}))

import { CallDetail } from '@/pages/CallDetail'
import { Calls } from '@/pages/Calls'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function callFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    direction: 'outbound',
    status: 'completed',
    fromE164: '+12015550100',
    toE164: '+12015550111',
    recordingPlanned: true,
    recordingReason: 'allowed',
    destinationState: 'DC',
    recordingEnabled: true,
    recordingUrl: 'https://recordings.example/signed/call-1.mp3',
    transcriptStatus: 'done',
    transcript: 'Hello, this is the final Deepgram transcript.',
    twilioCallSid: 'CA1',
    durationS: 73,
    startedAt: '2026-08-01T12:00:00.000Z',
    endedAt: '2026-08-01T12:01:13.000Z',
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

function renderJourney(call: ReturnType<typeof callFixture>) {
  useGetCallsMock.mockReturnValue({
    data: { calls: [call], total: 1, page: 1, limit: 25 },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
  useGetCallDetailMock.mockReturnValue({
    data: { call },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })

  return renderWithProviders(
    <Routes>
      <Route path="/calls" element={<Calls />} />
      <Route path="/calls/:id" element={<CallDetail />} />
    </Routes>,
    { initialEntries: ['/calls'] },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { id: 'user-a', timeZone: 'America/New_York' }, org: ORG })
})

describe('policy-owned outbound recording journey', () => {
  it('takes a policy-eligible recording from Ready in Calls to its final transcript in detail', async () => {
    const user = userEvent.setup()
    renderJourney(callFixture())

    expect(screen.getByText('Ready')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '+12015550111' }))

    expect(screen.getByText('Hello, this is the final Deepgram transcript.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy transcript' })).toBeInTheDocument()
  })

  it('keeps an unavailable call honest in Calls and detail', async () => {
    const user = userEvent.setup()
    renderJourney(callFixture({
      recordingPlanned: false,
      recordingReason: 'unknown-destination-state',
      recordingEnabled: false,
      recordingUrl: null,
      transcriptStatus: 'skipped-not-recorded',
      transcript: null,
    }))

    expect(screen.getByText('None')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '+12015550111' }))

    expect(screen.getByText('This call was not recorded, so there is no transcript.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy transcript' })).not.toBeInTheDocument()
  })
})
