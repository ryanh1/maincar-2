import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { toastSuccessMock, writeTextMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  writeTextMock: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: vi.fn() } }))

import { CellCopyMenu } from './CellCopyMenu'

const ANCHOR = { x: 0, y: 0, width: 100, height: 32 }

function stubClipboard() {
  // navigator.clipboard is a getter-only property in jsdom, so it is redefined
  // rather than assigned.
  Object.defineProperty(navigator, 'clipboard', { writable: true, value: { writeText: writeTextMock }, configurable: true })
  writeTextMock.mockResolvedValue(undefined)
}

describe('CellCopyMenu', () => {
  it('copies the raw E.164 value', async () => {
    const user = userEvent.setup()
    stubClipboard()
    renderWithProviders(<CellCopyMenu anchor={ANCHOR} rawValue="+14155552671" displayValue="(415) 555-2671" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Copy raw (E.164)' }))

    expect(writeTextMock).toHaveBeenCalledWith('+14155552671')
    expect(toastSuccessMock).toHaveBeenCalledWith('Raw number copied.')
  })

  it('copies the formatted national value', async () => {
    const user = userEvent.setup()
    stubClipboard()
    renderWithProviders(<CellCopyMenu anchor={ANCHOR} rawValue="+14155552671" displayValue="(415) 555-2671" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Copy formatted' }))

    expect(writeTextMock).toHaveBeenCalledWith('(415) 555-2671')
  })
})