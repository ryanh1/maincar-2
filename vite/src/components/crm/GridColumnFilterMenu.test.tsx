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
  it('keeps field sorting in the header while filtering moves to the toolbar builder', async () => {
    const user = userEvent.setup()
    const config = createViewConfig([attribute])
    const onConfigChange = vi.fn()
    renderWithProviders(<GridColumnFilterMenu attribute={attribute} config={config} onConfigChange={onConfigChange} open onOpenChange={vi.fn()} anchor={{ x: 16, y: 16, width: 160, height: 32 }} />)

    await user.click(screen.getByRole('button', { name: 'A to Z' }))
    await user.click(screen.getByRole('button', { name: 'Apply sort' }))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).sorts).toEqual([{ attributeId: 'status', direction: 'asc' }])
    expect(update(config).filterTree).toBeUndefined()
    expect(screen.queryByText('Filter by condition')).not.toBeInTheDocument()
  })
})
