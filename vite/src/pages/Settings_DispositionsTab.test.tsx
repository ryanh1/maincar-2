import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetDispositionsMock,
  useCreateDispositionMock,
  useUpdateDispositionMock,
  useArchiveDispositionMock,
  useUpdateDispositionBarMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetDispositionsMock: vi.fn(),
  useCreateDispositionMock: vi.fn(),
  useUpdateDispositionMock: vi.fn(),
  useArchiveDispositionMock: vi.fn(),
  useUpdateDispositionBarMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/dispositions', () => ({
  useGetDispositions: useGetDispositionsMock,
  useCreateDisposition: useCreateDispositionMock,
  useUpdateDisposition: useUpdateDispositionMock,
  useArchiveDisposition: useArchiveDispositionMock,
  useUpdateDispositionBar: useUpdateDispositionBarMock,
}))
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }))

import { Settings_DispositionsTab } from './Settings_DispositionsTab'

const ORG = { id: 'org-a', name: 'Acme' }
const rows = Array.from({ length: 8 }, (_, index) => ({
  id: `disposition-${index + 1}`,
  value: `outcome_${index + 1}`,
  label: `Outcome ${index + 1}`,
  color: `option-${index + 1}` as const,
  icon: index === 0 ? 'PhoneCall' : null,
  category: 'not_connected' as const,
  isStandard: true,
  isPinned: index < 7,
  pinOrder: index < 7 ? index : null,
  sortOrder: index,
  isArchived: false,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
}))

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true })
  useGetDispositionsMock.mockReturnValue({ isPending: false, isError: false, data: { dispositions: rows }, refetch: vi.fn() })
  for (const mutation of [useCreateDispositionMock, useUpdateDispositionMock, useArchiveDispositionMock]) {
    mutation.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) })
  }
  useUpdateDispositionBarMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({ dispositions: rows }) })
})

describe('Settings_DispositionsTab', () => {
  it('previews seven ordered outcomes and puts the eighth in More with a numeric badge', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_DispositionsTab />)

    expect(screen.getByRole('group', { name: 'Disposition bar preview' })).toHaveTextContent('Outcome 1')
    expect(screen.getByRole('button', { name: 'More dispositions (1)' })).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'More dispositions (1)' }))
    expect(screen.getByRole('menuitem', { name: 'Outcome 8' })).toBeInTheDocument()
  })

  it('keeps an eighth pin in overflow and gives the admin an honest warning', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_DispositionsTab />)

    await user.click(screen.getByRole('button', { name: 'Pin Outcome 8' }))

    expect(screen.getByText('Only seven dispositions fit in the bar. Outcome 8 stays in More.')).toBeInTheDocument()
  })

  it('reorders pins and publishes the complete final order in one request', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ dispositions: rows })
    useUpdateDispositionBarMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_DispositionsTab />)

    await user.click(screen.getByRole('button', { name: 'Move Outcome 2 left' }))
    await user.click(screen.getByRole('button', { name: 'Publish bar' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      pinnedIds: ['disposition-2', 'disposition-1', 'disposition-3', 'disposition-4', 'disposition-5', 'disposition-6', 'disposition-7'],
    })
  })

  it('keeps the staged order available when publishing fails so the admin can try again', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockRejectedValue(new Error('offline'))
    useUpdateDispositionBarMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_DispositionsTab />)

    await user.click(screen.getByRole('button', { name: 'Move Outcome 2 left' }))
    await user.click(screen.getByRole('button', { name: 'Publish bar' }))

    expect(screen.getByText('Could not publish the bar. Check your connection and try again.')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('group', { name: 'Disposition bar preview' }).firstElementChild).toHaveTextContent('Outcome 2')

    await user.click(screen.getByRole('button', { name: 'Publish bar' }))
    expect(mutateAsync).toHaveBeenCalledTimes(2)
  })
})
