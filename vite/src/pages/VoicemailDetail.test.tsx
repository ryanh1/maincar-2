import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetVoicemailMock, useDeleteVoicemailMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), useGetVoicemailMock: vi.fn(), useDeleteVoicemailMock: vi.fn(), toastErrorMock: vi.fn(), toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/voicemail', () => ({
  useGetVoicemail: useGetVoicemailMock,
  useDeleteVoicemail: useDeleteVoicemailMock,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { VoicemailDetail } from '@/pages/VoicemailDetail'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function voicemail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'voicemail-1', fromE164: '+12015550100', toE164: '+12015550111', durationS: 73,
    recordingUrl: 'https://recordings.example/signed/voicemail-1.mp3', transcriptStatus: 'done',
    transcript: 'Please call me back.', createdAt: '2026-08-22T12:00:00.000Z', ...overrides,
  }
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/voicemails/:id" element={<VoicemailDetail />} />
      <Route path="/voicemails" element={<div>Voicemail inbox</div>} />
    </Routes>,
    { initialEntries: ['/voicemails', '/voicemails/voicemail-1'] },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' }, org: ORG })
  useGetVoicemailMock.mockReturnValue({ data: { voicemail: voicemail() }, isPending: false, isError: false, refetch: vi.fn() })
  useDeleteVoicemailMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
})

describe('VoicemailDetail', () => {
  it('shows the voicemail facts in the viewing timezone', () => {
    renderDetail()
    expect(useGetVoicemailMock).toHaveBeenCalledWith('org-a', 'voicemail-1')
    expect(screen.getByText('+12015550100')).toBeInTheDocument()
    expect(screen.getByText('+12015550111')).toBeInTheDocument()
    expect(screen.getByText('01:13')).toBeInTheDocument()
    expect(screen.getByText(/Aug 22, 2026, 8:00 AM EDT/)).toBeInTheDocument()
  })

  it('shows a playable recording, download link, transcript, and copy control', () => {
    renderDetail()
    expect(screen.getByLabelText('Recording from +12015550100')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download recording' })).toHaveAttribute('href', 'https://recordings.example/signed/voicemail-1.mp3')
    expect(screen.getByText('Please call me back.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy transcript' })).toBeInTheDocument()
  })

  it('shows Transcribing while a transcript is pending', () => {
    useGetVoicemailMock.mockReturnValue({ data: { voicemail: voicemail({ transcriptStatus: 'pending', transcript: null }) }, isPending: false, isError: false, refetch: vi.fn() })
    renderDetail()
    expect(screen.getByText('Transcribing…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy transcript' })).not.toBeInTheDocument()
  })

  it('names a failed transcript', () => {
    useGetVoicemailMock.mockReturnValue({ data: { voicemail: voicemail({ transcriptStatus: 'failed', transcript: null }) }, isPending: false, isError: false, refetch: vi.fn() })
    renderDetail()
    expect(screen.getByText('The transcript could not be generated.')).toBeInTheDocument()
  })

  it('copies the transcript', async () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Copy transcript' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Please call me back.'))
  })

  it('confirms deletion before mutating and returns to the inbox on success', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn((_variables, options) => options.onSuccess())
    useDeleteVoicemailMock.mockReturnValue({ mutate, isPending: false })
    renderDetail()
    await user.click(screen.getByRole('button', { name: 'Delete voicemail' }))
    expect(screen.getByText('Delete this voicemail?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mutate).toHaveBeenCalledWith({ orgId: 'org-a', id: 'voicemail-1' }, expect.any(Object))
    expect(await screen.findByText('Voicemail inbox')).toBeInTheDocument()
  })

  it('returns to the inbox from Back', async () => {
    const user = userEvent.setup()
    renderDetail()
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }))
    expect(await screen.findByText('Voicemail inbox')).toBeInTheDocument()
  })
})
