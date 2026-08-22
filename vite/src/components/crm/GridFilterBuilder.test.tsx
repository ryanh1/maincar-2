import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { GridFilterBuilder } from './GridFilterBuilder'
import { createViewConfig } from './viewConfig'

const attributes = [
  {
    id: 'name',
    objectId: 'object-1',
    slug: 'name',
    name: 'Name',
    description: null,
    icon: null,
    type: 'text',
    optionsJson: null,
    refObjectId: null,
    formatJson: null,
    validationJson: null,
    isIdentity: true,
    storage: 'column',
    isMulti: false,
    isRequired: true,
    isUnique: false,
    isReadOnly: false,
    isSystem: false,
    defaultJson: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
] satisfies AttributeDef[]

const filterAttributes = [
  ...attributes,
  { ...attributes[0], id: 'stage', slug: 'stage', name: 'Stage', type: 'status' as const, optionsJson: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }], sortOrder: 1 },
  { ...attributes[0], id: 'amount', slug: 'amount', name: 'Amount', type: 'currency' as const, optionsJson: null, sortOrder: 2 },
] satisfies AttributeDef[]

function BuilderHarness() {
  const [config, setConfig] = useState(() => createViewConfig(filterAttributes))
  return <><GridFilterBuilder attributes={filterAttributes} config={config} onConfigChange={(update) => setConfig(update)} /><output>{JSON.stringify(config.filterTree)}</output></>
}

describe('GridFilterBuilder', () => {
  it('opens a toolbar filter control with an active-condition count', () => {
    const config = {
      ...createViewConfig(attributes),
      filterTree: {
        type: 'group' as const,
        op: 'and' as const,
        children: [{ type: 'condition' as const, attributeId: 'name', operator: 'contains' as const, value: 'Ada' }],
      },
    }

    renderWithProviders(<GridFilterBuilder attributes={attributes} config={config} onConfigChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Filter' })).toHaveTextContent('1')
  })

  it('emits nested AND/OR groups with none-of and between conditions in the durable filter tree', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BuilderHarness />)

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await user.click(screen.getByRole('combobox', { name: 'Field' }))
    await user.click(await screen.findByRole('option', { name: 'Stage' }))
    await user.click(screen.getByRole('combobox', { name: 'Operator for Stage' }))
    await user.click(await screen.findByRole('option', { name: 'is none of' }))
    await user.click(screen.getByRole('button', { name: 'Select Stage (0)' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Closed' }))
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    const fields = screen.getAllByRole('combobox', { name: 'Field' })
    await user.click(fields[1]!)
    await user.click(await screen.findByRole('option', { name: 'Amount' }))
    await user.click(screen.getByRole('combobox', { name: 'Operator for Amount' }))
    await user.click(await screen.findByRole('option', { name: 'is between' }))
    await user.type(screen.getByRole('textbox', { name: 'Value for Amount' }), '100')
    await user.type(screen.getByRole('textbox', { name: 'Second value for Amount' }), '200')

    expect(JSON.parse(screen.getByRole('status').textContent ?? 'null')).toEqual({
      type: 'group',
      op: 'and',
      children: [
        { type: 'condition', attributeId: 'stage', operator: 'not_in', value: ['closed'] },
        {
          type: 'group',
          op: 'and',
          children: [{ type: 'condition', attributeId: 'amount', operator: 'between', value: ['100', '200'] }],
        },
      ],
    })
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveTextContent('2')
  })
})
