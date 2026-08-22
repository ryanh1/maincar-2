import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

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
    data: { signatures: [{ id: 'sig-1', name: 'Work', bodyHtml: '<p>Ari</p>', isDefault: true }], total: 1 },
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  })
  saveMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
  deleteMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

describe('Settings_EmailSignaturesTab', () => {
  it('lists the rep’s signatures and labels the default', () => {
    renderWithProviders(<Settings_EmailSignaturesTab />)

    expect(screen.getByRole('heading', { name: 'Signatures' })).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getAllByText('Default')).toHaveLength(2)
  })

  it('opens a form to create a new signature', () => {
    renderWithProviders(<Settings_EmailSignaturesTab />)

    fireEvent.click(screen.getByRole('button', { name: 'New signature' }))

    expect(screen.getByRole('heading', { name: 'New signature' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Make this my default signature' })).toBeInTheDocument()
  })
})
