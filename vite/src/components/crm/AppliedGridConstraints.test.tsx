import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { AppliedGridConstraints } from './AppliedGridConstraints'
import { createViewConfig } from './viewConfig'

function attribute(id: string, name: string, optionsJson: AttributeDef['optionsJson'] = null): AttributeDef {
  return {
    id, objectId: 'object-1', slug: id, name, description: null, icon: null,
    type: optionsJson ? 'status' : 'text', optionsJson, refObjectId: null, formatJson: null, validationJson: null,
    isIdentity: false, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
    isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0, isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const attributes = [
  attribute('name', 'Name'),
  attribute('status', 'Status', [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]),
]

describe('AppliedGridConstraints', () => {
  it('removes one nested filter without changing the other constraints', async () => {
    const user = userEvent.setup()
    const config = {
      ...createViewConfig(attributes),
      sorts: [{ attributeId: 'name', direction: 'asc' as const }],
      filterTree: {
        type: 'group' as const,
        op: 'and' as const,
        children: [
          { type: 'condition' as const, attributeId: 'status', operator: 'in' as const, value: ['open'] },
          { type: 'condition' as const, attributeId: 'name', operator: 'contains' as const, value: 'Acme' },
        ],
      },
    }
    const onConfigChange = vi.fn()
    renderWithProviders(<AppliedGridConstraints attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    expect(screen.getByText('Name: A → Z')).toBeInTheDocument()
    expect(screen.getByText('Status is any of Open')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove the Status filter' }))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config)).toMatchObject({
      sorts: config.sorts,
      filterTree: { type: 'condition', attributeId: 'name', operator: 'contains', value: 'Acme' },
    })
  })

  it('clears only filters and sorting', async () => {
    const user = userEvent.setup()
    const config = {
      ...createViewConfig(attributes),
      rowHeight: 'tall' as const,
      sorts: [{ attributeId: 'name', direction: 'desc' as const }],
      filterTree: { type: 'condition' as const, attributeId: 'status', operator: 'eq' as const, value: 'open' },
    }
    const onConfigChange = vi.fn()
    renderWithProviders(<AppliedGridConstraints attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Clear all constraints' }))
    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config)).toEqual({ ...config, sorts: [], filterTree: undefined })
  })
})
