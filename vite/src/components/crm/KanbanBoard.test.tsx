import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

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
})
