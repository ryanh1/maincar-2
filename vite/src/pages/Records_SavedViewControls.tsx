import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent as ViewDialogContent, DialogDescription as ViewDialogDescription, DialogFooter as ViewDialogFooter, DialogHeader as ViewDialogHeader, DialogTitle as ViewDialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SavedView } from '@/hooks/savedViews'

import { Records_SavedViewControls_Menu } from './Records_SavedViewControls_Menu'

const DEFAULT_VIEW_ID = '__default__'

interface RecordsSavedViewControlsProps {
  views: SavedView[]
  selectedViewId: string | null
  hasUnsavedChanges: boolean
  isSaving: boolean
  onSelectView: (viewId: string | null) => void
  onSave: () => void
  onSaveAsNew?: (name: string) => void | Promise<void>
  onReset: () => void
  onRename: (name: string) => void | Promise<void>
  onDuplicate: () => void | Promise<void>
  onDelete: () => void | Promise<void>
  onRestore: () => void | Promise<void>
  onVisibilityChange: (isShared: boolean) => void | Promise<void>
  onSetDefault: () => void | Promise<void>
  onReorder: (viewIds: string[]) => void | Promise<void>
}

/** Saved-view selection and persistence controls for the record grid toolbar. */
export function Records_SavedViewControls({
  views,
  selectedViewId,
  hasUnsavedChanges,
  isSaving,
  onSelectView,
  onSave,
  onSaveAsNew,
  onReset,
  onRename,
  onDuplicate,
  onDelete,
  onRestore,
  onVisibilityChange,
  onSetDefault,
  onReorder,
}: RecordsSavedViewControlsProps) {
  const selectedView = views.find((view) => view.id === selectedViewId) ?? null
  const [newViewName, setNewViewName] = useState('')
  const [isNewViewDialogOpen, setIsNewViewDialogOpen] = useState(false)

  function closeNewViewDialog() {
    setIsNewViewDialogOpen(false)
    setNewViewName('')
  }

  async function saveAsNewView() {
    const name = newViewName.trim()
    if (!name || !onSaveAsNew) return
    await onSaveAsNew(name)
    closeNewViewDialog()
  }

  return (
    <div className="flex min-w-max items-center gap-1">
      <Select disabled={isSaving} value={selectedViewId ?? DEFAULT_VIEW_ID} onValueChange={(value) => onSelectView(value === DEFAULT_VIEW_ID ? null : value)}>
        <SelectTrigger aria-label="Saved view" size="sm" className="max-w-52 bg-bg">
          <SelectValue placeholder="Default view" />
        </SelectTrigger>
        <SelectContent>
          {!views.some((view) => view.isDefault) && <SelectItem value={DEFAULT_VIEW_ID}>Default view</SelectItem>}
          {views.map((view) => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <Records_SavedViewControls_Menu
        view={selectedView}
        views={views}
        disabled={isSaving}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onRestore={onRestore}
        onVisibilityChange={onVisibilityChange}
        onSetDefault={onSetDefault}
        onReorder={onReorder}
      />

      {hasUnsavedChanges && (
        <>
          <span role="status" className="text-xs text-text-muted">Unsaved changes</span>
          {selectedView?.isShared ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" size="sm" disabled={isSaving}>Save changes</Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Save changes to this Shared view?</AlertDialogTitle>
                  <AlertDialogDescription>This changes it for everyone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                  <AlertDialogAction size="sm" onClick={onSave}>Save changes to shared view</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button variant="secondary" size="sm" disabled={isSaving} onClick={onSave}>Save changes</Button>
          )}
          {onSaveAsNew && (
            <Button variant="secondary" size="sm" disabled={isSaving} onClick={() => setIsNewViewDialogOpen(true)}>
              Save as new view
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={isSaving} onClick={onReset}>Reset</Button>
        </>
      )}

      <Dialog open={isNewViewDialogOpen} onOpenChange={(open) => { if (!open) closeNewViewDialog() }}>
        <ViewDialogContent className="max-w-sm">
          <ViewDialogHeader>
            <ViewDialogTitle>Save as new view</ViewDialogTitle>
            <ViewDialogDescription>This saves the current arrangement as a new Personal view.</ViewDialogDescription>
          </ViewDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-saved-view-name">View name</Label>
            <Input
              id="new-saved-view-name"
              aria-label="New saved view name"
              autoFocus
              maxLength={120}
              value={newViewName}
              onChange={(event) => setNewViewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveAsNewView() } }}
            />
          </div>
          <ViewDialogFooter>
            <Button variant="secondary" size="sm" onClick={closeNewViewDialog} disabled={isSaving}>Cancel</Button>
            <Button size="sm" onClick={() => void saveAsNewView()} disabled={!newViewName.trim() || isSaving}>Save new view</Button>
          </ViewDialogFooter>
        </ViewDialogContent>
      </Dialog>
    </div>
  )
}
