import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DialerPostCallActions } from './DialerPostCallActions'

const {
  useAuthMock, useGetNextStepTypesMock, useGetDispositionNextStepRulesMock,
  useCompleteCallMock, toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetNextStepTypesMock: vi.fn(),
  useGetDispositionNextStepRulesMock: vi.fn(),
  useCompleteCallMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/nextSteps', () => ({
  useGetNextStepTypes: useGetNextStepTypesMock,
  useGetDispositionNextStepRules: useGetDispositionNextStepRulesMock,
}))
vi.mock('@/hooks/dialer', () => ({ useCompleteCall: useCompleteCallMock }))
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({ onChange }: { onChange?: (value: Date) => void }) => (
    <button type="button" onClick={() => onChange?.(new Date(2026, 7, 25))}>Choose callback date</button>
  ),
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

const callback = {
  id: 'callback', value: 'callback', label: 'Schedule callback', color: 'option-3', icon: null,
  isPinned: true, pinOrder: 0, sortOrder: 0, isOverflow: false, requiresDateTime: true, createsTask: true,
  isArchived: false, createdAt: '', updatedAt: '',
}
const followUp = { ...callback, id: 'follow-up', value: 'follow_up', label: 'Send follow-up', requiresDateTime: false }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' } })
  useGetNextStepTypesMock.mockReturnValue({ data: { types: [callback, followUp] } })
  useGetDispositionNextStepRulesMock.mockReturnValue({ data: { rules: [{ dispositionId: 'connected', nextStepType: callback }] } })
  useCompleteCallMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })
})

describe('DialerPostCallActions', () => {
  it('preselects the configured suggestion, lets a rep add a timezone-labelled callback, and saves the whole post-call action', async () => {
    const onSaved = vi.fn()
    const complete = vi.fn().mockResolvedValue({})
    useCompleteCallMock.mockReturnValue({ mutateAsync: complete, isPending: false })

    render(<DialerPostCallActions orgId="org-1" callId="call-1" dispositionId="connected" noteText="Asked for Tuesday." onSaved={onSaved} />)

    expect(screen.getByRole('button', { name: 'Remove Schedule callback' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Schedule callback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Schedule callback' }))
    expect(screen.getByText(/Times use EDT/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose callback date' }))
    fireEvent.change(screen.getByLabelText(/Time \(EDT\)/), { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add callback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save & Next' }))

    await waitFor(() => expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      dispositionId: 'connected', noteText: 'Asked for Tuesday.', nextSteps: [expect.objectContaining({ nextStepTypeId: 'callback', scheduledAt: expect.stringMatching(/Z$/) })],
    })))
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('keeps the post-call draft open when task creation fails', async () => {
    const onSaved = vi.fn()
    useCompleteCallMock.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(new Error('task failed')), isPending: false })

    render(<DialerPostCallActions orgId="org-1" callId="call-1" dispositionId="connected" noteText="" onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save & Next' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Could not save the call. Check your connection and try again.'))
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save & Next' })).toBeInTheDocument()
  })

  it('keeps an overflow next step out of the fixed row until the rep opens More', async () => {
    const user = userEvent.setup()
    useGetNextStepTypesMock.mockReturnValue({ data: { types: [callback, { ...followUp, isPinned: false, isOverflow: true }] } })

    render(<DialerPostCallActions orgId="org-1" callId="call-1" dispositionId="connected" noteText="" onSaved={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Send follow-up' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Send follow-up' })).toBeInTheDocument()
  })
})
