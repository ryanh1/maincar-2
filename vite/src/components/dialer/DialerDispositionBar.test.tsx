import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { Disposition } from '@/lib/dispositionTypes'
import { DialerDispositionBar } from './DialerDispositionBar'

const { useGetDispositionsMock, useLogCallDispositionMock, toastErrorMock } = vi.hoisted(() => ({
  useGetDispositionsMock: vi.fn(),
  useLogCallDispositionMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/hooks/dispositions', () => ({ useGetDispositions: useGetDispositionsMock }))
vi.mock('@/hooks/dialer', () => ({ useLogCallDisposition: useLogCallDispositionMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

const dispositions: Disposition[] = [
  { id: 'connected', value: 'connected', label: 'Connected', color: 'option-1', icon: null, category: 'connected', isStandard: true, isPinned: true, pinOrder: 0, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
  { id: 'no-answer', value: 'no_answer', label: 'No answer', color: 'option-3', icon: null, category: 'not_connected', isStandard: true, isPinned: true, pinOrder: 2, sortOrder: 2, isArchived: false, createdAt: '', updatedAt: '' },
  { id: 'busy', value: 'busy', label: 'Busy', color: 'option-4', icon: null, category: 'not_connected', isStandard: true, isPinned: true, pinOrder: 3, sortOrder: 3, isArchived: false, createdAt: '', updatedAt: '' },
  { id: 'custom', value: 'callback', label: 'Call back', color: 'option-7', icon: null, category: 'connected', isStandard: false, isPinned: false, pinOrder: null, sortOrder: 7, isArchived: false, createdAt: '', updatedAt: '' },
]

function renderBar(props: Partial<Parameters<typeof DialerDispositionBar>[0]> = {}) {
  useGetDispositionsMock.mockReturnValue({ isPending: false, isError: false, data: { dispositions } })
  const mutateAsync = vi.fn().mockResolvedValue({ call: { disposition: { id: 'connected', label: 'Connected' } } })
  useLogCallDispositionMock.mockReturnValue({ isPending: false, mutateAsync })
  const result = render(<DialerDispositionBar orgId="org-1" callId="call-1" {...props} />)
  return { ...result, mutateAsync }
}

describe('DialerDispositionBar', () => {
  it('saves a pinned disposition with its visible number shortcut exactly once', async () => {
    const { mutateAsync } = renderBar()

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: '1' })

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({ dispositionId: 'connected' })
  })

  it('offers unpinned dispositions through More', async () => {
    const { mutateAsync } = renderBar()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More call outcomes' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Call back' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ dispositionId: 'custom' }))
  })

  it('emits one typed completion event only after the disposition write succeeds', async () => {
    let resolveWrite: ((value: { call: { disposition: { id: string; label: string } } }) => void) | undefined
    const mutateAsync = vi.fn(() => new Promise<{ call: { disposition: { id: string; label: string } } }>((resolve) => { resolveWrite = resolve }))
    const onComplete = vi.fn()
    useGetDispositionsMock.mockReturnValue({ isPending: false, isError: false, data: { dispositions } })
    useLogCallDispositionMock.mockReturnValue({ isPending: false, mutateAsync })
    render(<DialerDispositionBar orgId="org-1" callId="call-1" onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /1.*Connected/ }))
    expect(onComplete).not.toHaveBeenCalled()

    resolveWrite?.({ call: { disposition: { id: 'connected', label: 'Connected' } } })
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ callId: 'call-1', dispositionId: 'connected' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does not emit completion after a refused save', async () => {
    const onComplete = vi.fn()
    const mutateAsync = vi.fn().mockRejectedValue(new Error('refused'))
    useGetDispositionsMock.mockReturnValue({ isPending: false, isError: false, data: { dispositions } })
    useLogCallDispositionMock.mockReturnValue({ isPending: false, mutateAsync })
    render(<DialerDispositionBar orgId="org-1" callId="call-1" onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /1.*Connected/ }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Could not save the call outcome. Try again.'))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it.each([
    ['no-answer', 'no-answer'],
    ['busy', 'busy'],
    ['failed', 'no-answer'],
  ] as const)('auto-saves the configured outcome once for a %s terminal status', async (terminalStatus, dispositionId) => {
    const { mutateAsync } = renderBar({ terminalStatus })

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ dispositionId }))
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })
})
