import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createViewConfig } from '@/components/crm/viewConfig'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
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

afterEach(() => toast.dismiss())

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
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onVisibilityChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReorder={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Saved view' }))
    expect(screen.getByRole('option', { name: 'My view' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Team pipeline' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Team pipeline' }))
    expect(onSelectView).toHaveBeenCalledWith('shared')

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
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
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onVisibilityChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReorder={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This changes it for everyone.')

    await user.click(screen.getByRole('button', { name: 'Save changes to shared view' }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('renames, duplicates, changes visibility, and sets the selected view as default', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const onDuplicate = vi.fn()
    const onVisibilityChange = vi.fn()
    const onSetDefault = vi.fn()

    renderWithProviders(
      <Records_SavedViewControls
        views={[{ ...personalView, isDefault: false }]}
        selectedViewId="personal"
        hasUnsavedChanges={false}
        isSaving={false}
        onSelectView={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onVisibilityChange={onVisibilityChange}
        onSetDefault={onSetDefault}
        onReorder={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Show actions for My view view' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename view' }))
    await user.clear(screen.getByRole('textbox', { name: 'Saved view name' }))
    await user.type(screen.getByRole('textbox', { name: 'Saved view name' }), 'Q3 prospects{Enter}')
    expect(onRename).toHaveBeenCalledWith('Q3 prospects')

    await user.click(screen.getByRole('button', { name: 'Show actions for My view view' }))
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate view' }))
    expect(onDuplicate).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Show actions for My view view' }))
    await user.click(screen.getByRole('menuitem', { name: 'Share with everyone' }))
    await user.click(screen.getByRole('button', { name: 'Share view' }))
    expect(onVisibilityChange).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole('button', { name: 'Show actions for My view view' }))
    await user.click(screen.getByRole('menuitem', { name: 'Set as default' }))
    expect(onSetDefault).toHaveBeenCalledOnce()
  })

  it('hides the unsaved-changes controls when the live config matches the saved view', () => {
    renderWithProviders(
      <Records_SavedViewControls
        views={[personalView]}
        selectedViewId="personal"
        hasUnsavedChanges={false}
        isSaving={false}
        onSelectView={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onVisibilityChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReorder={vi.fn()}
      />,
    )

    expect(screen.queryByRole('status', { name: 'Unsaved changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('supports keyboard selection and returns focus to the actions button when a rename is cancelled', async () => {
    const user = userEvent.setup()
    const onSelectView = vi.fn()

    renderWithProviders(
      <Records_SavedViewControls
        views={[personalView, sharedView]}
        selectedViewId="personal"
        hasUnsavedChanges={false}
        isSaving={false}
        onSelectView={onSelectView}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onVisibilityChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReorder={vi.fn()}
      />,
    )

    const switcher = screen.getByRole('combobox', { name: 'Saved view' })
    switcher.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onSelectView).toHaveBeenCalledWith('shared')

    const actions = screen.getByRole('button', { name: 'Show actions for My view view' })
    actions.focus()
    await user.keyboard('{Enter}{Enter}')
    expect(screen.getByRole('textbox', { name: 'Saved view name' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Show actions for My view view' })).toHaveFocus()
  })

  it('requires confirmation before deleting a Shared view and blocks deleting the default', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderWithProviders(
      <Records_SavedViewControls
        views={[{ ...sharedView, isDefault: false }]}
        selectedViewId="shared"
        hasUnsavedChanges={false}
        isSaving={false}
        onSelectView={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={onDelete}
        onRestore={vi.fn()}
        onVisibilityChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReorder={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Show actions for Team pipeline view' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete view' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This changes it for everyone.')
    await user.click(screen.getByRole('button', { name: 'Delete view' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('labels the default-view delete action with the required next step', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Records_SavedViewControls
        views={[personalView]}
        selectedViewId="personal"
        hasUnsavedChanges={false}
        isSaving={false}
        onSelectView={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onVisibilityChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReorder={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Show actions for My view view' }))
    expect(screen.getByRole('menuitem', { name: 'Set another default first' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('restores a deleted Personal view from the undo toast', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const onRestore = vi.fn()
    renderWithProviders(
      <>
        <Records_SavedViewControls
          views={[{ ...personalView, isDefault: false }]}
          selectedViewId="personal"
          hasUnsavedChanges={false}
          isSaving={false}
          onSelectView={vi.fn()}
          onSave={vi.fn()}
          onReset={vi.fn()}
          onRename={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={onDelete}
          onRestore={onRestore}
          onVisibilityChange={vi.fn()}
          onSetDefault={vi.fn()}
          onReorder={vi.fn()}
        />
        <Toaster />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Show actions for My view view' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete view' }))
    expect(onDelete).toHaveBeenCalledOnce()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(onRestore).toHaveBeenCalledOnce()
  })

  it('opens a drag-and-drop view order from the view menu', async () => {
    const user = userEvent.setup()
    const onReorder = vi.fn()
    renderWithProviders(
      <Records_SavedViewControls
        views={[personalView, { ...sharedView, isDefault: false }]}
        selectedViewId="personal"
        hasUnsavedChanges={false}
        isSaving={false}
        onSelectView={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        onVisibilityChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReorder={onReorder}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Show actions for My view view' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reorder views' }))
    expect(screen.getByRole('dialog', { name: 'Reorder views' })).toHaveTextContent('Drag views to change their order.')
    expect(screen.getByRole('button', { name: 'Reorder My view view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Team pipeline view' })).toBeInTheDocument()

  })
})
