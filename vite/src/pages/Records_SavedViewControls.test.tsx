import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createViewConfig } from '@/components/crm/viewConfig'
import { renderWithProviders } from '@/test/utils'

import { Records_SavedViewControls } from './Records_SavedViewControls'

const attributes = [{
  id: 'name', objectId: 'company', slug: 'name', name: 'Name', description: null,
  icon: null, type: 'text', optionsJson: null, refObjectId: null, formatJson: null,
  validationJson: null, isIdentity: true, storage: 'column', isMulti: false,
  isRequired: false, isUnique: false, isReadOnly: false, isSystem: true,
  defaultJson: null, sortOrder: 0, isArchived: false,
  createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
}]

const config = createViewConfig(attributes)

const personalView = {
  id: 'personal', objectId: 'company', name: 'My view', layout: 'grid' as const,
  config, ownerUserId: 'user-1', isShared: false, isDefault: true, sortOrder: 0,
  createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
}

const sharedView = { ...personalView, id: 'shared', name: 'Team pipeline', isShared: true }

describe('Records_SavedViewControls', () => {
  it('lists personal and shared views and lets the rep reset unsaved edits', async () => {
    const user = userEvent.setup()
    const onSelectView = vi.fn()
    const onReset = vi.fn()

    renderWithProviders(
      <Records_SavedViewControls
        views={[personalView, sharedView]}
        selectedViewId="personal"
        hasUnsavedChanges
        isSaving={false}
        onSelectView={onSelectView}
        onSave={vi.fn()}
        onReset={onReset}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Saved view' }))
    expect(screen.getByRole('option', { name: 'My view' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Team pipeline' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Team pipeline' }))
    expect(onSelectView).toHaveBeenCalledWith('shared')

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('asks before saving edits to a Shared view', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    renderWithProviders(
      <Records_SavedViewControls
        views={[sharedView]}
        selectedViewId="shared"
        hasUnsavedChanges
        isSaving={false}
        onSelectView={vi.fn()}
        onSave={onSave}
        onReset={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Save changes to this Shared view?')

    await user.click(screen.getByRole('button', { name: 'Save changes to shared view' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
})
