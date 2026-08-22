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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SavedView } from '@/hooks/savedViews'

const DEFAULT_VIEW_ID = '__default__'

interface RecordsSavedViewControlsProps {
  views: SavedView[]
  selectedViewId: string | null
  hasUnsavedChanges: boolean
  isSaving: boolean
  onSelectView: (viewId: string | null) => void
  onSave: () => void
  onReset: () => void
}

/** Saved-view selection and persistence controls for the record grid toolbar. */
export function Records_SavedViewControls({
  views,
  selectedViewId,
  hasUnsavedChanges,
  isSaving,
  onSelectView,
  onSave,
  onReset,
}: RecordsSavedViewControlsProps) {
  const selectedView = views.find((view) => view.id === selectedViewId)

  return (
    <div className="flex items-center gap-1">
      <Select disabled={isSaving} value={selectedViewId ?? DEFAULT_VIEW_ID} onValueChange={(value) => onSelectView(value === DEFAULT_VIEW_ID ? null : value)}>
        <SelectTrigger aria-label="Saved view" size="sm" className="max-w-52 bg-bg">
          <SelectValue placeholder="Default view" />
        </SelectTrigger>
        <SelectContent>
          {!views.some((view) => view.isDefault) && <SelectItem value={DEFAULT_VIEW_ID}>Default view</SelectItem>}
          {views.map((view) => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {hasUnsavedChanges && (
        <>
          {selectedView?.isShared ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={isSaving}>Save changes</Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Save changes to this Shared view?</AlertDialogTitle>
                  <AlertDialogDescription>Everyone with access sees your updates.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                  <AlertDialogAction size="sm" onClick={onSave}>Save changes to shared view</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button size="sm" disabled={isSaving} onClick={onSave}>Save changes</Button>
          )}
          <Button variant="secondary" size="sm" disabled={isSaving} onClick={onReset}>Reset</Button>
        </>
      )}
    </div>
  )
}
