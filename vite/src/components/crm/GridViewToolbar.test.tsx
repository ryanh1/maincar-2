import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { GridViewToolbar } from './GridViewToolbar'
import { createViewConfig } from './viewConfig'

const attributes = [
  {
    id: 'status',
    objectId: 'object-1',
    slug: 'status',
    name: 'Status',
    description: null,
    icon: null,
    type: 'status',
    optionsJson: [{ value: 'open', label: 'Open' }],
    refObjectId: null,
    formatJson: null,
    validationJson: null,
    isIdentity: false,
    storage: 'column',
    isMulti: false,
    isRequired: false,
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

describe('GridViewToolbar', () => {
  it('writes the same view config when choosing a sort from the toolbar', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await user.click(await screen.findByText('Status: Sort A→Z'))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).sorts).toEqual([{ attributeId: 'status', direction: 'asc' }])
  })

  it('writes field visibility, grouping, row height, and grid lines through the shared config', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Fields' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Status' }))
    const visibilityUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(visibilityUpdate(config).columns).toEqual([{ attributeId: 'status', visible: false, order: 0 }])
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Group' }))
    await user.click(await screen.findByText('Group by Status'))
    const groupUpdate = onConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    expect(groupUpdate(config).groupBy).toEqual([{ attributeId: 'status', direction: 'asc' }])

    await user.click(screen.getByRole('button', { name: 'Row height' }))
    await user.click(await screen.findByText('Comfortable'))
    const heightUpdate = onConfigChange.mock.calls[2][0] as (current: typeof config) => typeof config
    expect(heightUpdate(config).rowHeight).toBe('comfortable')

    await user.click(screen.getByRole('button', { name: 'Row height' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show grid lines' }))
    const linesUpdate = onConfigChange.mock.calls[3][0] as (current: typeof config) => typeof config
    expect(linesUpdate(config).gridLines).toBe(false)
  })
})
