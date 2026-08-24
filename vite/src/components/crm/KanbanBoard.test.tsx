import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { AttributeDef, RecordRow } from '@/lib/crmTypes'
import { makeTestQueryClient, renderWithProviders, withProviders } from '@/test/utils'

import { KanbanBoard } from './KanbanBoard'
import { createViewConfig } from './viewConfig'

const stage: AttributeDef = {
  id: 'stage', objectId: 'deal', slug: 'stage', name: 'Stage', description: null,
  icon: null, type: 'status', optionsJson: [
    { value: 'discovery', label: 'Discovery', color: 'option-1', order: 0 },
    { value: 'proposal', label: 'Proposal', color: 'option-2', order: 1 },
    { value: 'closed', label: 'Closed', color: 'option-3', order: 2 },
  ],
  refObjectId: null, formatJson: null, validationJson: null, isIdentity: false,
  storage: 'column', isMulti: false, isRequired: false, isUnique: false,
  isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 1,
  isArchived: false, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
}

const name: AttributeDef = { ...stage, id: 'name', slug: 'name', name: 'Deal', type: 'text', optionsJson: null, isIdentity: true, sortOrder: 0 }
const amount: AttributeDef = { ...stage, id: 'amount', slug: 'amount', name: 'Amount', type: 'currency', optionsJson: null, sortOrder: 2 }
const attributes = [name, stage, amount]

const rows: RecordRow[] = [
  { id: 'deal-1', createdAt: '', updatedAt: '', name: 'Northstar', stage: 'discovery', amount: 5000 },
  { id: 'deal-2', createdAt: '', updatedAt: '', name: 'Acme', stage: 'proposal', amount: 12000 },
  { id: 'deal-3', createdAt: '', updatedAt: '', name: 'Untitled', stage: null, amount: 700 },
  { id: 'deal-4', createdAt: '', updatedAt: '', name: 'Closed deal', stage: 'closed', amount: 900 },
]

afterEach(() => vi.restoreAllMocks())

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, right: x + width, bottom: y + height, left: x, toJSON: () => ({}) } as DOMRect
}

function mockBoardRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const label = this.getAttribute('aria-label')
    if (label === 'Discovery cards') return rect(0, 0, 288, 240)
    if (label === 'Proposal cards') return rect(300, 0, 288, 240)
    if (label === 'Closed cards') return rect(600, 0, 288, 240)
    if (label === 'No value cards') return rect(900, 0, 288, 240)
    if (this.textContent?.includes('Northstar')) return rect(8, 16, 272, 72)
    if (this.textContent?.includes('Bluebird')) return rect(8, 96, 272, 72)
    if (this.textContent?.includes('Acme')) return rect(308, 16, 272, 72)
    if (this.textContent?.includes('Untitled')) return rect(908, 16, 272, 72)
    return rect(0, 0, 0, 0)
  })
}

async function dragNorthstarTo(clientX: number, clientY: number) {
  const northstar = screen.getByText('Northstar').closest('[role="button"]')
  expect(northstar).not.toBeNull()
  fireEvent.pointerDown(northstar!, { button: 0, buttons: 1, clientX: 40, clientY: 40, pointerId: 1, pointerType: 'mouse', isPrimary: true })
  fireEvent.pointerMove(document, { buttons: 1, clientX: 40, clientY: 50, pointerId: 1, pointerType: 'mouse', isPrimary: true })
  await waitFor(() => expect(northstar).toHaveAttribute('aria-pressed', 'true'))
  fireEvent.pointerMove(document, { buttons: 1, clientX, clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true })
  await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('card:deal-1.'))
  fireEvent.pointerUp(document, { button: 0, buttons: 0, clientX, clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true })
  await waitFor(() => expect(screen.getByText('Northstar').closest('[role="button"]')).not.toHaveAttribute('aria-pressed'))
}

describe('KanbanBoard', () => {
  it('renders only valid configured option columns in order and keeps empty values in No value', () => {
    const config = {
      ...createViewConfig(attributes),
      kanban: {
        groupAttributeId: 'stage',
        visibleOptionValues: ['proposal', 'unknown', 'discovery', 'closed'],
        cardAttributeIds: ['amount'],
        hiddenTerminalOptionValues: ['closed'],
      },
    }

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={rows} />)

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Discovery 1 records', 'Proposal 1 records', 'No value 1 records',
    ])
    expect(screen.getByText('Northstar')).toBeInTheDocument()
    expect(screen.getByText('$5,000.00')).toBeInTheDocument()
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument()
  })

  it('renders the title plus selected fields on every card', () => {
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal'], cardAttributeIds: ['amount'] },
    }

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={rows} />)

    expect(screen.getByText('Northstar')).toBeInTheDocument()
    expect(screen.getAllByText('Amount')).toHaveLength(3)
  })

  it('reorders cards from pointer input within a populated column', async () => {
    const columnRows = [
      rows[0],
      { ...rows[1], id: 'deal-5', name: 'Bluebird', stage: 'discovery' },
    ]
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal', 'closed'], cardAttributeIds: [] },
    }
    mockBoardRects()

    const client = makeTestQueryClient()
    const view = renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={columnRows} onRecordMove={vi.fn()} />, { client })

    const northstar = screen.getByText('Northstar').closest('[role="button"]')
    expect(northstar).not.toBeNull()
    expect(northstar).toHaveStyle({ touchAction: 'none' })
    await dragNorthstarTo(40, 130)

    await waitFor(() => expect(screen.getByLabelText('Discovery cards').querySelectorAll('h3')[0]).toHaveTextContent('Bluebird'))
    view.rerender(withProviders(<KanbanBoard attributes={attributes} config={{ ...config }} rows={columnRows.map((row) => ({ ...row }))} onRecordMove={vi.fn()} />, { client }))
    expect(screen.getByLabelText('Discovery cards').querySelectorAll('h3')[0]).toHaveTextContent('Bluebird')
  })

  it('moves a card by pointer into a populated column through the record mutation path', async () => {
    const onRecordMove = vi.fn()
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal', 'closed'], cardAttributeIds: [] },
    }
    mockBoardRects()

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={rows} onRecordMove={onRecordMove} />)
    await dragNorthstarTo(340, 40)

    expect(onRecordMove).toHaveBeenCalledWith(rows[0], 'proposal')
  })

  it('moves a card by pointer into an empty column', async () => {
    const onRecordMove = vi.fn()
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal', 'closed'], cardAttributeIds: [] },
    }
    mockBoardRects()

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={[rows[0]]} onRecordMove={onRecordMove} />)
    await dragNorthstarTo(340, 160)

    expect(onRecordMove).toHaveBeenCalledWith(rows[0], 'proposal')
  })

  it('moves a card by pointer into the No value column', async () => {
    const onRecordMove = vi.fn()
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal', 'closed'], cardAttributeIds: [] },
    }
    mockBoardRects()

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={rows} onRecordMove={onRecordMove} />)
    await dragNorthstarTo(940, 160)

    expect(onRecordMove).toHaveBeenCalledWith(rows[0], null)
  })

  it('restores the original source order when a cross-column mutation rolls back', async () => {
    const originalRows = [
      rows[0],
      { ...rows[1], id: 'deal-5', name: 'Bluebird', stage: 'discovery' },
      rows[1],
    ]
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal', 'closed'], cardAttributeIds: [] },
    }
    let rollback = () => {}
    function RollbackHarness() {
      const [liveRows, setLiveRows] = useState(originalRows)
      return (
        <KanbanBoard
          attributes={attributes}
          config={config}
          rows={liveRows}
          onRecordMove={(record, value) => {
            setLiveRows((current) => current.map((row) => row.id === record.id ? { ...row, stage: value } : row))
            rollback = () => setLiveRows(originalRows.map((row) => ({ ...row })))
          }}
        />
      )
    }
    mockBoardRects()

    renderWithProviders(<RollbackHarness />)
    await dragNorthstarTo(340, 40)
    await waitFor(() => expect(screen.getByLabelText('Proposal cards').querySelectorAll('h3')).toHaveLength(2))
    act(() => rollback())

    expect([...screen.getByLabelText('Discovery cards').querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual(['Northstar', 'Bluebird'])
  })

  it('moves a focused card through a type-ahead picker without a pointer', async () => {
    const user = userEvent.setup()
    const onRecordMove = vi.fn()
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal', 'closed'], cardAttributeIds: [] },
    }

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={rows} onRecordMove={onRecordMove} />)

    const card = screen.getByText('Northstar').closest('[role="button"]')
    expect(card).not.toBeNull()
    card?.focus()
    await user.keyboard('p{Enter}')

    expect(onRecordMove).toHaveBeenCalledWith(rows[0], 'proposal')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('confirms the field and target before moving multiple selected cards', async () => {
    const user = userEvent.setup()
    const onRecordMove = vi.fn()
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'stage', visibleOptionValues: ['discovery', 'proposal', 'closed'], cardAttributeIds: [] },
    }
    const selectedRows = rows.slice(0, 2)

    renderWithProviders(
      <KanbanBoard
        attributes={attributes}
        config={config}
        rows={selectedRows}
        onRecordMove={onRecordMove}
        selectedRecordIds={new Set(selectedRows.map((row) => row.id))}
      />,
    )

    const card = screen.getByText('Northstar').closest('[role="button"]')
    card?.focus()
    await user.keyboard('c')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Stage')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Closed')
    expect(onRecordMove).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Move cards' }))
    expect(onRecordMove).toHaveBeenCalledTimes(2)
    expect(onRecordMove).toHaveBeenNthCalledWith(1, selectedRows[0], 'closed')
    expect(onRecordMove).toHaveBeenNthCalledWith(2, selectedRows[1], 'closed')
  })
})
