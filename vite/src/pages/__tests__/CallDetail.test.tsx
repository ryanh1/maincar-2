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
import { Route, Routes, useLocation } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetCallCommentsMock, useGetCallDetailMock, useLogCallDispositionMock, toastErrorMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCallCommentsMock: vi.fn(),
  useGetCallDetailMock: vi.fn(),
  useLogCallDispositionMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/dialer', () => ({
  useGetCallDetail: useGetCallDetailMock,
  useLogCallDisposition: useLogCallDispositionMock,
}))
vi.mock('@/hooks/callComments', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/callComments')>(),
  useGetCallComments: useGetCallCommentsMock,
  useCreateCallComment: () => ({ mutateAsync: vi.fn(), error: null }),
  useDeleteCallComment: () => ({ mutate: vi.fn(), error: null }),
  useReplyToCallComment: () => ({ mutateAsync: vi.fn(), error: null }),
  useToggleCallCommentReaction: () => ({ mutate: vi.fn(), error: null }),
  useUpdateCallComment: () => ({ mutateAsync: vi.fn(), error: null }),
}))
vi.mock('@/hooks/orgs', () => ({
  useGetMembers: () => ({ data: { members: [] }, isError: false }),
  memberDisplayName: vi.fn(),
}))
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

function review() {
  return {
    crm: {
      person: { id: 'person-1', firstName: 'Morgan', lastName: 'Lee', preferredFirstName: null },
      company: { id: 'company-1', name: 'Acme' },
      deal: { id: 'deal-1', name: 'Renewal', status: 'open' },
    },
    recording: { state: 'ready', source: { kind: 'audio', url: 'https://recordings.example/signed/call-1.mp3', expiresAt: '2026-08-01T13:00:00.000Z' } },
    transcript: { state: 'ready', pass: { id: 'pass-1', provider: 'test', plainText: 'Hello there.\nThe renewal works.', segments: [
      { id: 'segment-1', position: 0, speakerKey: 'rep', startMs: 0, endMs: 1_200, text: 'Hello there.', words: [
        { word: 'Hello', punctuatedWord: 'Hello', startMs: 0, endMs: 400 },
        { word: 'there', punctuatedWord: 'there.', startMs: 500, endMs: 1_000 },
      ] },
      { id: 'segment-2', position: 1, speakerKey: 'buyer', startMs: 1_400, endMs: 2_600, text: 'The renewal works.', words: [
        { word: 'The', punctuatedWord: 'The', startMs: 1_400, endMs: 1_600 },
        { word: 'renewal', punctuatedWord: 'renewal', startMs: 1_650, endMs: 2_000 },
        { word: 'works', punctuatedWord: 'works.', startMs: 2_050, endMs: 2_500 },
      ] },
    ] } },
    speakers: [
      { id: 'speaker-1', speakerKey: 'rep', displayName: 'Fixture Rep', source: 'call-user', confidence: 1, confirmedAt: null, manualOverride: false, person: null },
      { id: 'speaker-2', speakerKey: 'buyer', displayName: 'Morgan Lee', source: 'manual', confidence: 1, confirmedAt: null, manualOverride: true, person: null },
    ],
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
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="call-detail-location">{location.search}</output>
}

function renderDetail(initialEntry = '/calls/call-1') {
  return renderWithProviders(
    <Routes>
      <Route path="/calls/:id" element={<><CallDetail /><LocationProbe /></>} />
      <Route path="/calls" element={<div>Calls history</div>} />
    </Routes>,
    { initialEntries: [initialEntry] },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { id: 'user-a', timeZone: 'America/New_York' }, org: ORG })
  useGetCallCommentsMock.mockReturnValue({
    data: { comments: [], total: 0, page: 1, limit: 100 },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
  useGetCallDetailMock.mockReturnValue(detailState())
  useLogCallDispositionMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
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

  it('keeps timed transcript seeks, playback state, search ticks, and selections on the shared timeline', async () => {
    const user = userEvent.setup()
    useGetCallDetailMock.mockReturnValue(detailState({ data: { call: callDetail({ review: review() }) } }))
    renderDetail()
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 })
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 })
    fireEvent.loadedMetadata(audio)

    await user.click(screen.getByRole('button', { name: 'renewal, 00:01' }))
    expect(audio.currentTime).toBe(1.65)

    audio.currentTime = 1.7
    fireEvent.timeUpdate(audio)
    expect(screen.getByRole('button', { name: 'renewal, 00:01' })).toHaveAttribute('aria-current', 'true')

    await user.type(screen.getByRole('searchbox', { name: 'Search transcript' }), 'renewal')
    expect(screen.getByTestId('speaker-ribbon-marker-transcript-search-0')).toBeInTheDocument()

    const renewal = screen.getByRole('button', { name: 'renewal, 00:01' }).querySelector('mark')?.firstChild
    if (!renewal) throw new Error('Timed renewal word did not render')
    const range = document.createRange()
    range.setStart(renewal, 0)
    range.setEnd(renewal, 7)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.mouseUp(screen.getByTestId('timed-transcript-content'))

    expect(screen.getByTestId('speaker-ribbon-selection-range')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Comment on selection' }))
    expect(screen.getAllByText('“renewal”').length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: 'Comment on selected transcript text' })).toBeInTheDocument()
  })

  it('converges comment deep links, timestamps, ribbon pins, and playback highlighting on one moment', async () => {
    const user = userEvent.setup()
    const comments = [
      {
        id: 'comment-1',
        parentId: null,
        atMs: 1_650,
        anchorEndMs: null,
        anchorQuote: null,
        selectionStartChar: null,
        selectionEndChar: null,
        transcriptId: null,
        bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First moment' }] }] },
        bodyText: 'First moment',
        deletedAt: null,
        createdAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-01T12:00:00.000Z',
        author: { id: 'user-a', name: 'Grace Hopper', imageUrl: null },
        reactions: [],
        replies: [],
      },
      {
        id: 'comment-2',
        parentId: null,
        atMs: 2_500,
        anchorEndMs: null,
        anchorQuote: null,
        selectionStartChar: null,
        selectionEndChar: null,
        transcriptId: null,
        bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second moment' }] }] },
        bodyText: 'Second moment',
        deletedAt: null,
        createdAt: '2026-08-01T12:00:01.000Z',
        updatedAt: '2026-08-01T12:00:01.000Z',
        author: { id: 'user-a', name: 'Grace Hopper', imageUrl: null },
        reactions: [],
        replies: [],
      },
    ]
    useGetCallDetailMock.mockReturnValue(detailState({ data: { call: callDetail({ review: review() }) } }))
    useGetCallCommentsMock.mockReturnValue({
      data: { comments, total: 2, page: 1, limit: 100 },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

    renderDetail('/calls/call-1?mode=comments&commentId=comment-2')
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 })
    fireEvent.loadedMetadata(audio)

    await waitFor(() => expect(audio.currentTime).toBe(2.5))
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-comment-id="comment-2"]')).toHaveAttribute('data-active', 'true')

    const transcript = screen.getByRole('region', { name: 'Timed transcript' })
    fireEvent.wheel(transcript)
    expect(screen.getByRole('button', { name: 'Jump to current' })).toBeInTheDocument()
    scrollIntoView.mockClear()

    let currentTime = audio.currentTime
    let seekWrites = 0
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        seekWrites += 1
        currentTime = value
      },
    })
    const search = screen.getByRole('searchbox', { name: 'Search transcript' })
    search.focus()
    currentTime = 1.7
    fireEvent.timeUpdate(audio)
    expect(document.querySelector('[data-comment-id="comment-1"]')).toHaveAttribute('data-nearest', 'true')
    expect(search).toHaveFocus()

    seekWrites = 0
    await user.click(screen.getByRole('button', { name: /00:01Aug 1, 2026/ }))
    expect(seekWrites).toBe(1)
    expect(document.querySelector('[data-comment-id="comment-1"]')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('call-detail-location')).toHaveTextContent('?mode=comments&commentId=comment-1')
    expect(scrollIntoView).toHaveBeenCalled()

    seekWrites = 0
    await user.click(screen.getByRole('button', { name: 'Open comment at 00:02' }))
    expect(seekWrites).toBe(1)
    expect(document.querySelector('[data-comment-id="comment-2"]')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('call-detail-location')).toHaveTextContent('?mode=comments&commentId=comment-2')
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

  it('names a recording lifecycle state when no signed source is ready yet', () => {
    useGetCallDetailMock.mockReturnValue(
      detailState({
        data: {
          call: callDetail({
            recordingUrl: null,
            review: { ...review(), recording: { state: 'processing', source: null } },
          }),
        },
      }),
    )
    renderDetail()

    expect(screen.getByText('Recording is processing.')).toBeInTheDocument()
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

describe('the review workbench', () => {
  beforeEach(() => {
    useGetCallDetailMock.mockReturnValue(detailState({ data: { call: callDetail({ review: review() }) } }))
  })

  it('renders CRM context, independent panes, and the balanced layout by default', () => {
    renderDetail()

    expect(screen.getByRole('navigation', { name: 'Call context' })).toHaveTextContent('Morgan Lee')
    expect(screen.getByRole('heading', { name: 'Playback' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Comments' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize playback and comments panes' })).toHaveAttribute('aria-valuenow', '60')
  })

  it('switches the desktop layout with a keyboard-adjustable divider and remembers the choice', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Focus comments' }))
    const divider = screen.getByRole('separator', { name: 'Resize playback and comments panes' })
    expect(divider).toHaveAttribute('aria-valuenow', '40')

    divider.focus()
    await user.keyboard('{ArrowRight}')
    expect(divider).toHaveAttribute('aria-valuenow', '42')
    expect(window.localStorage.getItem('maincar:call-review-layout:user-a')).toContain('42')
  })

  it('offers accessible playback and comments navigation for narrow layouts', async () => {
    const user = userEvent.setup()
    renderDetail()

    const commentsTab = screen.getByRole('tab', { name: 'Comments' })
    await user.click(commentsTab)

    expect(commentsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Comments' })).toBeInTheDocument()
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
