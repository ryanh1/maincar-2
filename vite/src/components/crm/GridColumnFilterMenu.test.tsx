import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { GridColumnFilterMenu } from './GridColumnFilterMenu'
import { createViewConfig } from './viewConfig'

const attribute = {
  id: 'status', objectId: 'object-1', slug: 'status', name: 'Status', description: null, icon: null,
  type: 'status', optionsJson: [], refObjectId: null, formatJson: null, validationJson: null,
  isIdentity: false, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
  isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0, isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies AttributeDef

describe('GridColumnFilterMenu', () => {
  it('stages header sorting and value filtering until Apply', async () => {
    const user = userEvent.setup()
    const config = createViewConfig([attribute])
    const onConfigChange = vi.fn()
    renderWithProviders(<GridColumnFilterMenu attribute={attribute} config={config} onConfigChange={onConfigChange} open onOpenChange={vi.fn()} anchor={{ x: 16, y: 16, width: 160, height: 32 }} values={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />)

    await user.click(screen.getByRole('button', { name: 'A to Z' }))
    await user.click(screen.getByRole('checkbox', { name: 'Open' }))
    expect(onConfigChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config)).toMatchObject({
      sorts: [{ attributeId: 'status', direction: 'asc' }],
      filterTree: { type: 'condition', attributeId: 'status', operator: 'in', value: ['open'] },
    })
  })

  it('searches values, reports the selection count, and cancels without applying', async () => {
    const user = userEvent.setup()
    const config = createViewConfig([attribute])
    const onConfigChange = vi.fn()
    const onOpenChange = vi.fn()
    renderWithProviders(<GridColumnFilterMenu attribute={attribute} config={config} onConfigChange={onConfigChange} open onOpenChange={onOpenChange} anchor={{ x: 16, y: 16, width: 160, height: 32 }} values={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />)

    await user.type(screen.getByRole('searchbox', { name: 'Search values for Status' }), 'open')
    expect(screen.getByRole('checkbox', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Closed' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Open' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfigChange).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('offers type-aware conditions without applying the draft early', async () => {
    const user = userEvent.setup()
    const amount = { ...attribute, id: 'amount', slug: 'amount', name: 'Amount', type: 'currency' as const }
    const config = createViewConfig([amount])
    const onConfigChange = vi.fn()
    renderWithProviders(<GridColumnFilterMenu attribute={amount} config={config} onConfigChange={onConfigChange} open onOpenChange={vi.fn()} anchor={{ x: 16, y: 16, width: 160, height: 32 }} values={[]} />)

    await user.click(screen.getByRole('button', { name: 'Filter by condition' }))
    await user.click(screen.getByRole('menuitem', { name: 'Number is greater than' }))
    await user.type(screen.getByRole('textbox', { name: 'Value for Amount' }), '100')
    expect(onConfigChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).filterTree).toEqual({ type: 'condition', attributeId: 'amount', operator: 'gt', value: '100' })
  })

  it('stages Clear filter so Cancel leaves the live filter intact', async () => {
    const user = userEvent.setup()
    const config = {
      ...createViewConfig([attribute]),
      filterTree: { type: 'condition' as const, attributeId: 'status', operator: 'in' as const, value: ['open'] },
    }
    const onConfigChange = vi.fn()
    renderWithProviders(<GridColumnFilterMenu attribute={attribute} config={config} onConfigChange={onConfigChange} open onOpenChange={vi.fn()} anchor={{ x: 16, y: 16, width: 160, height: 32 }} values={[{ value: 'open', label: 'Open' }]} />)

    await user.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(onConfigChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfigChange).not.toHaveBeenCalled()
  })

  it('sets a manual header colour and clears it back to automatic', async () => {
    const user = userEvent.setup()
    const config = createViewConfig([attribute])
    const onConfigChange = vi.fn()
    renderWithProviders(<GridColumnFilterMenu attribute={attribute} config={config} onConfigChange={onConfigChange} open onOpenChange={vi.fn()} anchor={{ x: 16, y: 16, width: 160, height: 32 }} values={[]} />)

    await user.click(screen.getByRole('button', { name: 'Header colour option-3' }))
    const setUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(setUpdate(config).columnStyles).toEqual([{ attributeId: 'status', headerColor: 'option-3' }])

    await user.click(screen.getByRole('button', { name: 'Clear header colour' }))
    const clearUpdate = onConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    expect(clearUpdate(config).columnStyles).toEqual([])
  })
})
