import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { ChangeHighlightOverlay } from './ChangeHighlightOverlay'
import { changeDotCount } from './changeHighlightCanvas'

const attribute = { id: 'status', slug: 'status', name: 'Status', type: 'text' } as AttributeDef

describe('ChangeHighlightOverlay', () => {
  it('caps visual badges at three dots', () => {
    expect(changeDotCount(1)).toBe(1)
    expect(changeDotCount(3)).toBe(3)
    expect(changeDotCount(8)).toBe(3)
  })

  it('explains the previous-to-current change and opens its full history', async () => {
    const user = userEvent.setup()
    const onShowFullHistory = vi.fn()

    renderWithProviders(
      <ChangeHighlightOverlay
        hover={{
          recordId: 'record-1',
          attribute,
          change: { recordId: 'record-1', attributeId: 'status', changeCount: 4, previousValue: 'Open', currentValue: 'Won', changedAt: '2026-08-22T12:00:00.000Z' },
          bounds: { x: 20, y: 40, width: 160, height: 32 },
        }}
        timeZone="America/New_York"
        onShowFullHistory={onShowFullHistory}
      />,
    )

    expect(screen.getByText('4 changes')).toBeInTheDocument()
    expect(screen.getByText('Open → Won')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'See full history' }))
    expect(onShowFullHistory).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'record-1', attribute }))
  })
})
