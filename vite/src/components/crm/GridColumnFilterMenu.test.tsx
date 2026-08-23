import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

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
  it('leaves multi-level sorting to the toolbar popover while retaining header freeze actions', () => {
    const config = createViewConfig([attribute])
    const onConfigChange = vi.fn()
    renderWithProviders(<GridColumnFilterMenu attribute={attribute} config={config} onConfigChange={onConfigChange} open onOpenChange={vi.fn()} anchor={{ x: 16, y: 16, width: 160, height: 32 }} />)

    expect(screen.queryByRole('button', { name: 'A to Z' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply sort' })).not.toBeInTheDocument()
    expect(onConfigChange).not.toHaveBeenCalled()
  })
})
