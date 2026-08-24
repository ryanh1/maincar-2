import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, withProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetVoicemailDropsMock,
  uploadMock,
  renameMock,
  setDefaultMock,
  deleteMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetVoicemailDropsMock: vi.fn(),
  uploadMock: vi.fn(),
  renameMock: vi.fn(),
  setDefaultMock: vi.fn(),
  deleteMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))
vi.mock('@/hooks/voicemailDrops', () => ({
  useGetVoicemailDrops: useGetVoicemailDropsMock,
  useUploadVoicemailDrop: () => ({ mutateAsync: uploadMock, isPending: false }),
  useRenameVoicemailDrop: () => ({ mutateAsync: renameMock, isPending: false }),
  useSetDefaultVoicemailDrop: () => ({ mutateAsync: setDefaultMock, isPending: false }),
  useDeleteVoicemailDrop: () => ({ mutateAsync: deleteMock, isPending: false }),
}))

import { VoicemailDrops } from '@/pages/VoicemailDrops'

const ORG = { id: 'org-1', name: 'Acme' }

const drops = [
  {
    id: 'drop-1',
    name: 'Sales follow-up',
    duration: 73,
    transcript: 'Hi, this is Ann from Acme calling about your request.',
    transcriptStatus: 'done' as const,
    status: 'ready' as const,
    isDefault: true,
    audioUrl: 'https://audio.example/drop-1.mp3',
  },
  {
    id: 'drop-2',
    name: 'After-hours callback',
    duration: 12,
    transcript: null,
    transcriptStatus: 'pending' as const,
    status: 'transcribing' as const,
    isDefault: false,
    audioUrl: 'https://audio.example/drop-2.mp3',
  },
]

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: { drops, total: drops.length },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG })
  useGetVoicemailDropsMock.mockReturnValue(queryState())
  uploadMock.mockResolvedValue({})
  renameMock.mockResolvedValue({})
  setDefaultMock.mockResolvedValue({})
  deleteMock.mockResolvedValue(undefined)
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

describe('VoicemailDrops', () => {
  it('lists each drop and plays its audio when the rep clicks the name', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VoicemailDrops />)

    expect(screen.getByRole('heading', { name: /Voicemail drops/ })).toBeInTheDocument()
    expect(screen.getByText('01:13')).toBeInTheDocument()
    expect(screen.getByText('Hi, this is Ann from Acme calling about your request.')).toBeInTheDocument()
    expect(screen.getByText('Transcribing…')).toBeInTheDocument()
    expect(screen.getAllByText('Default')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Sales follow-up' }))

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
  })

  it('renames inline, moves the default star, and confirms deletion', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VoicemailDrops />)

    await user.click(screen.getByRole('button', { name: 'Rename After-hours callback' }))
    const input = screen.getByRole('textbox', { name: 'Name for After-hours callback' })
    await user.clear(input)
    await user.type(input, 'Evening callback')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(renameMock).toHaveBeenCalledWith({ orgId: 'org-1', dropId: 'drop-2', name: 'Evening callback' })

    await user.click(screen.getByRole('button', { name: 'Make After-hours callback the default voicemail drop' }))
    expect(setDefaultMock).toHaveBeenCalledWith({ orgId: 'org-1', dropId: 'drop-2' })

    await user.click(screen.getByRole('button', { name: 'Delete After-hours callback' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete After-hours callback?')
    await user.click(screen.getByRole('button', { name: 'Delete drop' }))
    expect(deleteMock).toHaveBeenCalledWith({ orgId: 'org-1', dropId: 'drop-2' })
  })

  it('uploads a named WebM from the picker or drop zone', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VoicemailDrops />)

    await user.click(screen.getByRole('button', { name: 'Upload drop' }))
    const pickerFile = new File(['picker'], 'picker.webm', { type: 'audio/webm' })
    await user.upload(screen.getByLabelText('Choose a WebM file'), pickerFile)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Picker drop')
    await user.click(screen.getByRole('button', { name: 'Upload voicemail drop' }))
    expect(uploadMock).toHaveBeenCalledWith({ orgId: 'org-1', file: pickerFile, name: 'Picker drop' })

    await user.click(screen.getByRole('button', { name: 'Upload drop' }))
    const droppedFile = new File(['drop'], 'dropped.webm', { type: 'audio/webm' })
    fireEvent.drop(screen.getByTestId('voicemail-drop-zone'), { dataTransfer: { files: [droppedFile] } })
    expect(screen.getByText('dropped.webm')).toBeInTheDocument()
  })

  it('keeps editable work open when a mutation fails and names the recovery action', async () => {
    const user = userEvent.setup()
    renameMock.mockRejectedValueOnce(new Error('offline'))
    renderWithProviders(<VoicemailDrops />)

    await user.click(screen.getByRole('button', { name: 'Rename After-hours callback' }))
    const input = screen.getByRole('textbox', { name: 'Name for After-hours callback' })
    await user.clear(input)
    await user.type(input, 'Evening callback')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(toastErrorMock).toHaveBeenCalledWith('Could not rename the voicemail drop. Try again.')
    expect(screen.getByRole('textbox', { name: 'Name for After-hours callback' })).toHaveValue('Evening callback')
  })

  it('shows loading, actionable error, and an upload-first empty state', async () => {
    useGetVoicemailDropsMock.mockReturnValue(queryState({ data: undefined, isPending: true }))
    const { rerender } = renderWithProviders(<VoicemailDrops />)
    expect(screen.getByLabelText('Loading voicemail drops')).toBeInTheDocument()

    const refetch = vi.fn()
    useGetVoicemailDropsMock.mockReturnValue(queryState({ data: undefined, isError: true, refetch }))
    rerender(withProviders(<VoicemailDrops />))
    expect(screen.getByText('Could not load voicemail drops.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()

    useGetVoicemailDropsMock.mockReturnValue(queryState({ data: { drops: [], total: 0 } }))
    rerender(withProviders(<VoicemailDrops />))
    expect(screen.getByText('Upload the first voicemail drop')).toBeInTheDocument()
  })
})
