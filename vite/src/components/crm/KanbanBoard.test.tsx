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
]

describe('KanbanBoard', () => {
  it('renders configured option columns in order plus No value, cards, count, and a summary', () => {
    const config = {
      ...createViewConfig(attributes),
      groupBy: [{ attributeId: 'stage', direction: 'asc' as const }],
      kanbanCardFieldIds: ['amount'],
      kanbanSummaryAttributeId: 'amount',
    }

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={rows} />)

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Discovery 1', 'Proposal 1', 'No value 1',
    ])
    expect(screen.getByText('Northstar')).toBeInTheDocument()
    expect(screen.getByText('$5,000.00')).toBeInTheDocument()
    expect(screen.getByText('Total $12,000.00')).toBeInTheDocument()
  })

  it('uses the identity field and first three visible fields when no card fields are saved', () => {
    const config = { ...createViewConfig(attributes), groupBy: [{ attributeId: 'stage', direction: 'asc' as const }] }

    renderWithProviders(<KanbanBoard attributes={attributes} config={config} rows={rows} />)

    expect(screen.getByText('Northstar')).toBeInTheDocument()
    expect(screen.getAllByText('Amount')).toHaveLength(3)
  })
})
