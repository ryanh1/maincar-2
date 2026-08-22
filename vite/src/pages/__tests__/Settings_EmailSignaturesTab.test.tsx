import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { Settings_EmailSignaturesTab } from '../Settings_EmailSignaturesTab'

const { useAuthMock, getMock, saveMock, deleteMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getMock: vi.fn(),
  saveMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/email', () => ({
  useGetEmailSignatures: getMock,
  useSaveEmailSignature: saveMock,
  useDeleteEmailSignature: deleteMock,
}))
vi.mock('@/components/editor/RichTextEditor', () => ({
  RichTextEditor: ({ label }: { label: string }) => <div role="textbox" aria-label={label} />,
}))
vi.mock('@/components/editor/RichTextEditor_UrlDialog', () => ({
  RichTextEditorUrlDialog: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
  getMock.mockReturnValue({
    data: {
      signatures: [
        {
          id: 'sig-1', name: 'Work', bodyHtml: '<p>Ari</p>', isDefault: true,
          isDefaultForNew: true, isDefaultForReply: false,
        },
        {
          id: 'sig-2', name: 'Personal', bodyHtml: '<p>Ari</p>', isDefault: false,
          isDefaultForNew: false, isDefaultForReply: true,
        },
      ],
      total: 2,
    },
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  })
  saveMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
  deleteMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

describe('Settings_EmailSignaturesTab', () => {
  it('keeps a selected signature in an accessible master-detail editor and labels both defaults', () => {
    renderWithProviders(<Settings_EmailSignaturesTab />, { initialEntries: ['/settings?tab=signatures&signature=sig-2'] })

    expect(screen.getByRole('heading', { name: 'Signatures' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Signatures' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Personal/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Personal')
    expect(screen.getByRole('combobox', { name: 'Default signature for new messages' })).toHaveTextContent('Work')
    expect(screen.getByRole('combobox', { name: 'Default signature for replies and forwards' })).toHaveTextContent('Personal')
  })

  it('creates a blank signature in the detail pane without leaving the list', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailSignaturesTab />)

    await user.click(screen.getByRole('button', { name: 'New signature' }))

    expect(screen.getByRole('listbox', { name: 'Signatures' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveValue('')
  })

  it('moves the selected signature with the arrow keys', () => {
    renderWithProviders(<Settings_EmailSignaturesTab />, { initialEntries: ['/settings?tab=signatures&signature=sig-2'] })

    fireEvent.keyDown(screen.getByRole('option', { name: /Personal/ }), { key: 'ArrowUp' })

    expect(screen.getByRole('option', { name: /Work/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Work')
  })
})
