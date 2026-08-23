import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { GridSortPopover } from './GridSortPopover'
import { createViewConfig } from './viewConfig'

const attributes = [
  {
    id: 'owner', objectId: 'object-1', slug: 'ownerUserId', name: 'Owner', description: null, icon: null,
    type: 'user_reference', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null,
    isIdentity: false, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
    isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0, isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'stage', objectId: 'object-1', slug: 'stage', name: 'Stage', description: null, icon: null,
    type: 'status', optionsJson: [], refObjectId: null, formatJson: null, validationJson: null,
    isIdentity: false, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
    isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 1, isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
] satisfies AttributeDef[]

describe('GridSortPopover', () => {
  it('adds a second priority, changes its direction, and clears all sorting through the shared view config', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = { ...createViewConfig(attributes), sorts: [{ attributeId: 'owner', direction: 'asc' as const }] }

    const { rerender } = renderWithProviders(<GridSortPopover attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Sort · 1' }))
    expect(screen.getByText('Owner')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add another sort' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Stage' }))

    const addUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(addUpdate(config).sorts).toEqual([
      { attributeId: 'owner', direction: 'asc' },
      { attributeId: 'stage', direction: 'asc' },
    ])

    const addedConfig = addUpdate(config)
    rerender(<GridSortPopover attributes={attributes} config={addedConfig} onConfigChange={onConfigChange} />)
    await user.click(screen.getByRole('button', { name: 'Sort · 2' }))
    await user.click(screen.getByRole('button', { name: 'Sort Stage descending' }))
    const directionUpdate = onConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    expect(directionUpdate(addedConfig).sorts).toEqual([
      { attributeId: 'owner', direction: 'asc' },
      { attributeId: 'stage', direction: 'desc' },
    ])

    await user.click(screen.getByRole('button', { name: 'Clear sort' }))
    const clearUpdate = onConfigChange.mock.calls[2][0] as (current: typeof config) => typeof config
    expect(clearUpdate(config).sorts).toEqual([])
  })
})
