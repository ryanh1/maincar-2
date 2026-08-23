import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AttributeDef } from '@/lib/crmTypes'
import { renderWithProviders } from '@/test/utils'

import { KanbanCardFieldPicker } from './KanbanCardFieldPicker'
import { createViewConfig } from './viewConfig'

const attributes = Array.from({ length: 7 }, (_, index) => ({
  id: `field-${index}`,
  objectId: 'deal',
  slug: `field${index}`,
  name: `Field ${index}`,
  description: null,
  icon: null,
  type: 'text',
  optionsJson: null,
  refObjectId: null,
  formatJson: null,
  validationJson: null,
  isIdentity: index === 0,
  storage: 'column',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
  isSystem: false,
  defaultJson: null,
  sortOrder: index,
  isArchived: false,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
})) satisfies AttributeDef[]

describe('KanbanCardFieldPicker', () => {
  it('writes picked fields into the shared view config and warns softly after five fields', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'field-1', visibleOptionValues: ['field-1'], cardAttributeIds: ['field-1', 'field-2', 'field-3', 'field-4', 'field-5'] },
    }

    const view = renderWithProviders(<KanbanCardFieldPicker attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Card fields' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Field 6' }))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    const nextConfig = update(config)
    expect(nextConfig.kanban?.cardAttributeIds).toEqual(['field-1', 'field-2', 'field-3', 'field-4', 'field-5', 'field-6'])
    view.rerender(<KanbanCardFieldPicker attributes={attributes} config={nextConfig} onConfigChange={onConfigChange} />)
    expect(screen.getByText('Cards get noisy with more than five fields.')).toBeInTheDocument()
  })
})
