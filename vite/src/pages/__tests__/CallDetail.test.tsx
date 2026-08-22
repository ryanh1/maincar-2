// Single call detail (MAI-40).
//
// What these protect:
//   - every fact renders: from, to, direction, outcome, duration, started, ended
//   - direction and outcome show LABELS, never the raw enum value
//   - every time carries its zone label, in the viewing user's zone; a missing
//     timestamp is a dash, never a bare local time
//   - the transcript renders its text when ready, and a sensible message for
//     pending / failed / skipped-not-recorded
//   - the recording is an <audio> player plus a download link when present, and an
//     honest empty state when absent
//   - Copy transcript writes the transcript to the clipboard
//   - Delete is DISABLED — there is no delete-call-record endpoint yet
//   - Back returns to /calls
//   - loading and error states each render
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetCallDetailMock, toastErrorMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCallDetailMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/dialer', () => ({ useGetCallDetail: useGetCallDetailMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

import { CallDetail } from '@/pages/CallDetail'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function callDetail(overrides: Record<string, unknown> = {}) {
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
    transcript: 'Hello, this is a test transcript.',
    twilioCallSid: 'CA1',
    durationS: 73,
    startedAt: '2026-08-01T12:00:00.000Z',
    endedAt: '2026-08-01T12:01:13.000Z',
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

function detailState(overrides: Record<string, unknown> = {}) {
  return {
    data: { call: callDetail() },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

// The page reads its id from the path, so it renders inside a matching route. A
// sibling /calls route stands in for the history list, so the Back link has a
// place to land that the test can detect.
function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/calls/:id" element={<CallDetail />} />
      <Route path="/calls" element={<div>Calls history</div>} />
    </Routes>,
    { initialEntries: ['/calls/call-1'] },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' }, org: ORG })
  useGetCallDetailMock.mockReturnValue(detailState())
  // navigator.clipboard is a getter-only property in jsdom, so it is redefined
  // rather than assigned.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

describe('the call facts', () => {
  it('queries the detail for the org and the id from the path', () => {
    renderDetail()
    expect(useGetCallDetailMock).toHaveBeenCalledWith('org-a', 'call-1')
  })

  it('shows from, to, direction, outcome, and duration — enums as labels', () => {
    renderDetail()

    expect(screen.getByText('+12015550100')).toBeInTheDocument()
    // toE164 appears as both the title and the To value.
    expect(screen.getAllByText('+12015550111').length).toBeGreaterThan(0)
    // Never the raw enum value.
    expect(screen.getByText('Outbound')).toBeInTheDocument()
    expect(screen.queryByText('outbound')).not.toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
    expect(screen.getByText('01:13')).toBeInTheDocument()
  })

  it('renders started and ended in the viewing user timezone, with the zone named', () => {
    renderDetail()

    // 12:00:00 UTC is 8:00 AM in New York; 12:01:13 UTC is 8:01 AM.
    expect(screen.getByText(/Aug 1, 2026, 8:00 AM EDT/)).toBeInTheDocument()
    expect(screen.getByText(/Aug 1, 2026, 8:01 AM EDT/)).toBeInTheDocument()
  })

  it('shows a dash for a duration or a timestamp that is not set', () => {
    useGetCallDetailMock.mockReturnValue(
      detailState({
        data: { call: callDetail({ durationS: null, startedAt: null, endedAt: null }) },
      }),
    )
    renderDetail()

    expect(screen.getAllByText('—').length).toBe(3)
  })
})

describe('the transcript', () => {
  it('shows the transcript text and a Copy button when it is ready', () => {
    renderDetail()

    expect(screen.getByText('Hello, this is a test transcript.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy transcript' })).toBeInTheDocument()
  })

  it('says Transcribing while the transcript is pending, with no Copy button', () => {
    useGetCallDetailMock.mockReturnValue(
      detailState({ data: { call: callDetail({ transcriptStatus: 'pending', transcript: null }) } }),
    )
    renderDetail()

    expect(screen.getByText('Transcribing…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy transcript' })).not.toBeInTheDocument()
  })

  it('names the failure when the transcript could not be made', () => {
    useGetCallDetailMock.mockReturnValue(
      detailState({ data: { call: callDetail({ transcriptStatus: 'failed', transcript: null }) } }),
    )
    renderDetail()

    expect(screen.getByText('The transcript could not be generated.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy transcript' })).not.toBeInTheDocument()
  })

  it('explains a call that was never recorded has no transcript', () => {
    useGetCallDetailMock.mockReturnValue(
      detailState({
        data: {
          call: callDetail({ transcriptStatus: 'skipped-not-recorded', transcript: null }),
        },
      }),
    )
    renderDetail()

    expect(
      screen.getByText('This call was not recorded, so there is no transcript.'),
    ).toBeInTheDocument()
  })

  it('reads a done-but-empty transcript as a plain fact, with no Copy button', () => {
    useGetCallDetailMock.mockReturnValue(
      detailState({ data: { call: callDetail({ transcriptStatus: 'done', transcript: '' }) } }),
    )
    renderDetail()

    expect(screen.getByText('No speech was transcribed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy transcript' })).not.toBeInTheDocument()
  })

  it('copies the transcript to the clipboard', async () => {
    // fireEvent, not userEvent: userEvent.setup() installs its own clipboard stub
    // that would replace the mock this assertion reads.
    renderDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Copy transcript' }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello, this is a test transcript.'),
    )
  })

  it('tells the reader to copy by hand when the clipboard write fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    renderDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Copy transcript' }))
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Could not copy the transcript. Copy it by hand.'),
    )
  })
})

describe('the recording', () => {
  it('renders a player and a download link when a recording exists', () => {
    renderDetail()

    expect(
      screen.getByLabelText('Recording of the call to +12015550111'),
    ).toBeInTheDocument()
    const download = screen.getByRole('link', { name: 'Download' })
    expect(download).toHaveAttribute('href', 'https://recordings.example/signed/call-1.mp3')
  })

  it('shows an honest empty state when there is no recording', () => {
    useGetCallDetailMock.mockReturnValue(
      detailState({ data: { call: callDetail({ recordingUrl: null }) } }),
    )
    renderDetail()

    expect(screen.queryByLabelText('Recording of the call to +12015550111')).not.toBeInTheDocument()
    expect(screen.getByText('This call has no recording.')).toBeInTheDocument()
  })
})

describe('the controls', () => {
  it('disables Delete — there is no delete-call-record endpoint yet', () => {
    renderDetail()

    expect(screen.getByRole('button', { name: 'Delete call' })).toBeDisabled()
  })

  it('returns to the call history from Back', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(screen.getByRole('link', { name: 'Back' }))
    expect(await screen.findByText('Calls history')).toBeInTheDocument()
  })
})

describe('loading and error', () => {
  it('shows a loading state while the call loads', () => {
    useGetCallDetailMock.mockReturnValue(detailState({ data: undefined, isPending: true }))
    renderDetail()

    expect(screen.queryByText('+12015550100')).not.toBeInTheDocument()
  })

  it('offers a retry when the call fails to load', async () => {
    const refetch = vi.fn()
    useGetCallDetailMock.mockReturnValue(
      detailState({ data: undefined, isPending: false, isError: true, refetch }),
    )
    const user = userEvent.setup()
    renderDetail()

    expect(screen.getByText('Could not load this call.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })
})
