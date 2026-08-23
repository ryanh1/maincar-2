import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InCallWorkspace } from './InCallWorkspace'

const { useDialerMock, useGetCallDetailMock, useSaveCallNoteMock, saveNoteMock } = vi.hoisted(() => ({
  useDialerMock: vi.fn(),
  useGetCallDetailMock: vi.fn(),
  useSaveCallNoteMock: vi.fn(),
  saveNoteMock: vi.fn(),
}))

vi.mock('@/components/dialer/dialerContext', () => ({ useDialer: useDialerMock }))
vi.mock('@/hooks/dialer', () => ({
  useGetCallDetail: useGetCallDetailMock,
  useSaveCallNote: useSaveCallNoteMock,
}))
vi.mock('./InCallControls', () => ({ InCallControls: () => <div data-testid="call-controls" /> }))
vi.mock('./NumericKeypad', () => ({ NumericKeypad: () => <div data-testid="keypad" /> }))

function detail(overrides: Record<string, unknown> = {}) {
  return {
    call: {
      id: 'call-1',
      toE164: '+12025550123',
      noteText: null,
      review: {
        crm: {
          person: { id: 'person-1', firstName: 'Jordan', lastName: 'Lee', preferredFirstName: null },
          company: { id: 'company-1', name: 'Acme' },
          deal: null,
        },
      },
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  useDialerMock.mockReturnValue({ phase: 'ringing' })
  useGetCallDetailMock.mockReturnValue({ data: undefined })
  useSaveCallNoteMock.mockReturnValue({ mutate: saveNoteMock, isPending: false })
})

afterEach(() => vi.useRealTimers())

describe('InCallWorkspace', () => {
  it('shows the raw number while detail context loads, then the linked person and company', () => {
    const { rerender } = render(
      <InCallWorkspace orgId="org-1" callId="call-1" toE164="+12025550123" recording={false} />,
    )

    expect(screen.getByText('+12025550123')).toBeInTheDocument()
    expect(screen.queryByText('Jordan Lee')).not.toBeInTheDocument()

    useGetCallDetailMock.mockReturnValue({ data: detail() })
    rerender(<InCallWorkspace orgId="org-1" callId="call-1" toE164="+12025550123" recording={false} />)

    expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('focuses notes when the call becomes live, not while it rings', () => {
    const { rerender } = render(
      <InCallWorkspace orgId="org-1" callId="call-1" toE164="+12025550123" recording={false} />,
    )

    const notes = screen.getByRole('textbox', { name: 'Call notes' })
    expect(notes).not.toHaveFocus()

    useDialerMock.mockReturnValue({ phase: 'in-progress' })
    rerender(<InCallWorkspace orgId="org-1" callId="call-1" toE164="+12025550123" recording={false} />)

    expect(notes).toHaveFocus()
  })

  it('debounces note saves and keeps typed text through a status refresh', () => {
    const { rerender } = render(
      <InCallWorkspace orgId="org-1" callId="call-1" toE164="+12025550123" recording={false} />,
    )

    const notes = screen.getByRole('textbox', { name: 'Call notes' })
    fireEvent.change(notes, { target: { value: 'Asked for a demo.' } })
    useGetCallDetailMock.mockReturnValue({ data: detail({ status: 'in-progress', noteText: null }) })
    rerender(<InCallWorkspace orgId="org-1" callId="call-1" toE164="+12025550123" recording={false} />)

    expect(notes).toHaveValue('Asked for a demo.')
    act(() => { vi.advanceTimersByTime(500) })
    expect(saveNoteMock).toHaveBeenCalledWith({ noteText: 'Asked for a demo.' })
  })

  it('opens the keypad over notes while leaving call controls available', () => {
    render(<InCallWorkspace orgId="org-1" callId="call-1" toE164="+12025550123" recording={false} />)

    expect(screen.queryByTestId('keypad')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open keypad' }))

    expect(screen.getByTestId('keypad')).toBeInTheDocument()
    expect(screen.getByTestId('call-controls')).toBeInTheDocument()
  })
})
