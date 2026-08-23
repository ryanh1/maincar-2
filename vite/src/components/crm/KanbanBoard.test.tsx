import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AttributeDef, RecordRow } from '@/lib/crmTypes'
import { renderWithProviders } from '@/test/utils'

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
