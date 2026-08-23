import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetDispositionsMock,
  useGetNextStepTypesMock,
  useGetDispositionNextStepRulesMock,
  useCreateNextStepTypeMock,
  useUpdateNextStepTypeMock,
  useUpdateNextStepBarMock,
  useSaveDispositionNextStepRuleMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetDispositionsMock: vi.fn(),
  useGetNextStepTypesMock: vi.fn(),
  useGetDispositionNextStepRulesMock: vi.fn(),
  useCreateNextStepTypeMock: vi.fn(),
  useUpdateNextStepTypeMock: vi.fn(),
  useUpdateNextStepBarMock: vi.fn(),
  useSaveDispositionNextStepRuleMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/dispositions', () => ({ useGetDispositions: useGetDispositionsMock }))
vi.mock('@/hooks/nextSteps', () => ({
  useGetNextStepTypes: useGetNextStepTypesMock,
  useGetDispositionNextStepRules: useGetDispositionNextStepRulesMock,
  useCreateNextStepType: useCreateNextStepTypeMock,
  useUpdateNextStepType: useUpdateNextStepTypeMock,
  useUpdateNextStepBar: useUpdateNextStepBarMock,
  useSaveDispositionNextStepRule: useSaveDispositionNextStepRuleMock,
}))
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }))

import { Settings_NextStepsTab } from './Settings_NextStepsTab'

const ORG = { id: 'org-a', name: 'Acme' }
const types = Array.from({ length: 8 }, (_, index) => ({
  id: `next-step-${index + 1}`,
  value: index === 0 ? 'callback' : `step_${index + 1}`,
  label: index === 0 ? 'Callback' : `Step ${index + 1}`,
  color: `option-${index + 1}` as const,
  icon: index === 0 ? 'PhoneCall' : null,
  isPinned: index < 7,
  pinOrder: index < 7 ? index : null,
  sortOrder: index,
  isOverflow: index >= 7,
  requiresDateTime: index === 0,
  createsTask: index === 0,
  isArchived: false,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
}))
const dispositions = [{ id: 'disposition-no-answer', value: 'no_answer', label: 'No answer', color: 'option-1' as const, icon: null, category: 'not_connected' as const, isStandard: true, isPinned: false, pinOrder: null, sortOrder: 0, isArchived: false, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' }]

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true })
  useGetDispositionsMock.mockReturnValue({ isPending: false, isError: false, data: { dispositions }, refetch: vi.fn() })
  useGetNextStepTypesMock.mockReturnValue({ isPending: false, isError: false, data: { types }, refetch: vi.fn() })
  useGetDispositionNextStepRulesMock.mockReturnValue({ isPending: false, isError: false, data: { rules: [] }, refetch: vi.fn() })
  for (const mutation of [useCreateNextStepTypeMock, useUpdateNextStepTypeMock, useUpdateNextStepBarMock, useSaveDispositionNextStepRuleMock]) {
    mutation.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({ types }) })
  }
})

describe('Settings_NextStepsTab', () => {
  it('saves date-time and task behavior with a new next-step type', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ type: types[0] })
    useCreateNextStepTypeMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_NextStepsTab />)

    await user.click(screen.getByRole('button', { name: 'Add next step' }))
    await user.type(screen.getByLabelText('Label'), 'Send contract')
    await user.type(screen.getByLabelText('Value'), 'send_contract')
    await user.click(screen.getByRole('switch', { name: 'Require a date and time' }))
    await user.click(screen.getByRole('switch', { name: 'Create a task' }))
    await user.click(screen.getByRole('button', { name: 'Save next step' }))

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Send contract', value: 'send_contract', requiresDateTime: true, createsTask: true,
    }))
  })

  it('maps an active disposition to an active next step', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ rule: { dispositionId: dispositions[0].id, nextStepTypeId: types[0].id } })
    useSaveDispositionNextStepRuleMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_NextStepsTab />)

    await user.click(screen.getByRole('combobox', { name: 'Suggested next step for No answer' }))
    await user.click(screen.getByRole('option', { name: 'Callback' }))

    expect(mutateAsync).toHaveBeenCalledWith({ dispositionId: 'disposition-no-answer', nextStepTypeId: 'next-step-1' })
  })

  it('does not send the stable value when editing a next-step type', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ type: types[0] })
    useUpdateNextStepTypeMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_NextStepsTab />)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    await user.clear(screen.getByLabelText('Label'))
    await user.type(screen.getByLabelText('Label'), 'Call back')
    await user.click(screen.getByRole('button', { name: 'Save next step' }))

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'next-step-1', label: 'Call back' }))
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty('value')
  })

  it('keeps an eighth pin in overflow and explains the limit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_NextStepsTab />)

    await user.click(screen.getByRole('button', { name: 'Pin Step 8' }))

    expect(screen.getByText('Only seven next steps fit in the row. Step 8 stays in More.')).toBeInTheDocument()
  })

  it('keeps the staged order available when publishing fails', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockRejectedValue(new Error('offline'))
    useUpdateNextStepBarMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_NextStepsTab />)

    await user.click(screen.getByRole('button', { name: 'Move Step 2 left' }))
    await user.click(screen.getByRole('button', { name: 'Publish next-step row' }))

    expect(screen.getByText('Could not publish the next-step row. Check your connection and try again.')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('group', { name: 'Next-step row preview' }).firstElementChild).toHaveTextContent('Step 2')
  })
})
