import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Settings_VoicemailGreetingTab } from './Settings_VoicemailGreetingTab'

const getGreeting = vi.hoisted(() => vi.fn())
const upload = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }))
const activate = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }))
const remove = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }))

vi.mock('@/providers/useAuth', () => ({ useAuth: () => ({ org: { id: 'org-1' }, isAdmin: true }) }))
vi.mock('@/hooks/voicemailGreeting', () => ({
  useGetVoicemailGreeting: getGreeting,
  useUploadVoicemailGreeting: () => upload,
  useActivateVoicemailGreeting: () => activate,
  useDeleteVoicemailGreeting: () => remove,
}))

const active = { id: 'active-1', status: 'active' as const, audioUrl: 'https://audio.example/active.mp3', durationSeconds: 12, failureReason: null, uploadedAt: null, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z' }
const ready = { ...active, id: 'ready-1', status: 'ready' as const, audioUrl: 'https://audio.example/ready.mp3' }

describe('Settings_VoicemailGreetingTab', () => {
  beforeEach(() => {
    getGreeting.mockReturnValue({ isLoading: false, isError: false, data: { greeting: { active, candidates: [ready] } } })
    upload.mutate.mockReset(); activate.mutate.mockReset(); remove.mutate.mockReset()
  })

  it('keeps the active greeting playable while a ready candidate awaits explicit replacement', async () => {
    const user = userEvent.setup()
    render(<Settings_VoicemailGreetingTab />)

    expect(screen.getByRole('heading', { name: 'Voicemail greeting' })).toBeInTheDocument()
    expect(screen.getByLabelText('Active voicemail greeting')).toHaveAttribute('src', active.audioUrl)
    expect(screen.getByRole('button', { name: 'Replace active greeting' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Replace active greeting' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Replace the active greeting?')
    await user.click(screen.getByRole('button', { name: 'Replace greeting' }))
    expect(activate.mutate).toHaveBeenCalledWith({ orgId: 'org-1', greetingId: 'ready-1' }, expect.any(Object))
  })

  it('uploads a selected recording and displays an actionable failure state', async () => {
    const user = userEvent.setup()
    getGreeting.mockReturnValue({ isLoading: false, isError: false, data: { greeting: { active: null, candidates: [{ ...ready, status: 'failed' as const, failureReason: 'Greeting is longer than 120 seconds.' }] } } })
    render(<Settings_VoicemailGreetingTab />)

    expect(screen.getByText('Greeting is longer than 120 seconds.')).toBeInTheDocument()
    const file = new File(['audio'], 'greeting.webm', { type: 'audio/webm' })
    await user.upload(screen.getByLabelText('Upload a greeting'), file)
    const preview = screen.getByLabelText('Greeting candidate preview') as HTMLAudioElement
    Object.defineProperty(preview, 'duration', { configurable: true, value: 10 })
    fireEvent.loadedMetadata(preview)
    await user.click(screen.getByRole('button', { name: 'Upload candidate' }))
    expect(upload.mutate).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', file }), expect.any(Object))
    await user.click(screen.getByRole('button', { name: 'Delete failed greeting' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete greeting' }))
    expect(remove.mutate).toHaveBeenCalledWith({ orgId: 'org-1', greetingId: 'ready-1' }, expect.any(Object))
  })
})
