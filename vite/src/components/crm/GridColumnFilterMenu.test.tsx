import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { GridColumnFilterMenu } from './GridColumnFilterMenu'
import { createViewConfig } from './viewConfig'

const attribute = {
  id: 'status',
  objectId: 'object-1',
  slug: 'status',
  name: 'Status',
  description: null,
  icon: null,
  type: 'status',
  optionsJson: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }],
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
} satisfies AttributeDef

function renderMenu(onConfigChange = vi.fn(), config = createViewConfig([attribute])) {
  renderWithProviders(
    <GridColumnFilterMenu
      attribute={attribute}
      config={config}
      onConfigChange={onConfigChange}
      open
      onOpenChange={vi.fn()}
      anchor={{ x: 16, y: 16, width: 160, height: 32 }}
      values={[
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed' },
      ]}
    />,
  )
  return { onConfigChange, config }
}

describe('GridColumnFilterMenu', () => {
  it('keeps value-filter changes pending until Apply, then writes the shared config', async () => {
    const user = userEvent.setup()
    const { onConfigChange, config } = renderMenu()

    expect(screen.getByText('0 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Open' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(onConfigChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply filter' }))
    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).filterTree).toEqual({ type: 'condition', attributeId: 'status', operator: 'in', value: ['open'] })
  })

  it('offers type-aware conditions and applies the selected text condition', async () => {
    const user = userEvent.setup()
    const { onConfigChange, config } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Filter by condition' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Text contains' }))
    await user.type(screen.getByRole('textbox', { name: 'Value for Status' }), 'trial')
    await user.click(screen.getByRole('button', { name: 'Apply filter' }))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).filterTree).toEqual({ type: 'condition', attributeId: 'status', operator: 'contains', value: 'trial' })
  })

  it('uses boolean equality rather than an unsupported values-list operator for checkbox columns', async () => {
    const user = userEvent.setup()
    const checkboxAttribute = { ...attribute, id: 'subscribed', slug: 'subscribed', name: 'Subscribed', type: 'checkbox' as const, optionsJson: null }
    const config = createViewConfig([checkboxAttribute])
    const onConfigChange = vi.fn()
    renderWithProviders(
      <GridColumnFilterMenu attribute={checkboxAttribute} config={config} onConfigChange={onConfigChange} open onOpenChange={vi.fn()} anchor={{ x: 16, y: 16, width: 160, height: 32 }} values={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Apply filter' }))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).filterTree).toEqual({ type: 'condition', attributeId: 'subscribed', operator: 'eq', value: true })
  })

  it('clears an applied filter through the shared config', async () => {
    const user = userEvent.setup()
    const config = {
      ...createViewConfig([attribute]),
      filterTree: { type: 'condition' as const, attributeId: 'status', operator: 'in' as const, value: ['open'] },
    }
    const { onConfigChange } = renderMenu(vi.fn(), config)

    await user.click(screen.getByRole('button', { name: 'Clear filter' }))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).filterTree).toBeUndefined()
  })

  it('keeps the required Clear and Apply actions in the shared interaction contract', () => {
    const config = {
      ...createViewConfig([attribute]),
      filterTree: { type: 'condition' as const, attributeId: 'status', operator: 'in' as const, value: ['open'] },
    }
    renderMenu(vi.fn(), config)

    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel filter changes' })).toBeInTheDocument()
  })
})
