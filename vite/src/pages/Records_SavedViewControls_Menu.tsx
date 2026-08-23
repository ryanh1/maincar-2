import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import type { SavedView } from '@/hooks/savedViews'

import { Records_SavedViewControls_ReorderDialog } from './Records_SavedViewControls_ReorderDialog'

type MenuAction = () => void | Promise<void>

type Confirmation = {
  title: string
  description: string
  actionLabel: string
  onConfirm: MenuAction
}

interface SavedViewMenuProps {
  view: SavedView | null
  views: SavedView[]
  disabled: boolean
  onRename: (name: string) => void | Promise<void>
  onDuplicate: MenuAction
  onDelete: MenuAction
  onRestore: MenuAction
  onVisibilityChange: (isShared: boolean) => void | Promise<void>
  onSetDefault: MenuAction
  onReorder: (viewIds: string[]) => void | Promise<void>
}

/** Actions for the selected saved view, including Shared-view safeguards. */
export function Records_SavedViewControls_Menu({
  view,
  views,
  disabled,
  onRename,
  onDuplicate,
  onDelete,
  onRestore,
  onVisibilityChange,
  onSetDefault,
  onReorder,
}: SavedViewMenuProps) {
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreMenuFocus = useRef(false)

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus()
    } else if (shouldRestoreMenuFocus.current) {
      shouldRestoreMenuFocus.current = false
      menuTriggerRef.current?.focus()
    }
  }, [isRenaming])

  if (!view) return null
  const selectedView = view

  function requestConfirmation(next: Confirmation) {
    setConfirmation(next)
  }

  function run(action: MenuAction) {
    void action()
  }

  function rename() {
    const name = renameValue.trim()
    if (!name) return
    const save = async () => {
      await onRename(name)
      setIsRenaming(false)
    }
    if (selectedView.isShared) requestConfirmation({ title: 'Rename this Shared view?', description: 'This changes it for everyone.', actionLabel: 'Rename view', onConfirm: save })
    else run(save)
  }

  function deleteView() {
    const remove = async () => {
      await onDelete()
      toast.success('View deleted.', { action: { label: 'Undo', onClick: () => run(onRestore) } })
    }
    if (selectedView.isShared) requestConfirmation({ title: 'Delete this Shared view?', description: 'This changes it for everyone.', actionLabel: 'Delete view', onConfirm: remove })
    else run(remove)
  }

  function changeVisibility() {
    const isSharing = !selectedView.isShared
    requestConfirmation({
      title: isSharing ? 'Share this view?' : 'Make this view personal?',
      description: isSharing
        ? "Members of this organization can find this in this object's view switcher. This does not create a public link."
        : 'This view will no longer appear in other organization members’ switchers.',
      actionLabel: isSharing ? 'Share with workspace' : 'Make personal',
      onConfirm: () => onVisibilityChange(isSharing),
    })
  }

  return (
    <>
      {isRenaming ? (
        <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); rename() }}>
          <Input
            ref={renameInputRef}
            aria-label="Saved view name"
            className="h-8 w-40 text-sm"
            disabled={disabled}
            maxLength={120}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              shouldRestoreMenuFocus.current = true
              setIsRenaming(false)
            }}
          />
        </form>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton ref={menuTriggerRef} disabled={disabled} tooltip={`Show actions for ${selectedView.name} view`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => { setRenameValue(selectedView.name); setIsRenaming(true) }}>Rename view</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(onDuplicate)}>Duplicate view</DropdownMenuItem>
            <DropdownMenuItem onSelect={changeVisibility}>{selectedView.isShared ? 'Make personal' : 'Share with workspace'}</DropdownMenuItem>
            <DropdownMenuItem disabled={selectedView.isDefault} onSelect={() => run(onSetDefault)}>
              {selectedView.isDefault ? 'Already the default' : 'Set as default'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIsReordering(true)}>Reorder views</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={selectedView.isDefault} onSelect={deleteView}>
              {selectedView.isDefault ? 'Set another default first' : 'Delete view'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" variant={confirmation?.actionLabel === 'Delete view' ? 'destructive' : 'default'} onClick={() => { if (confirmation) run(confirmation.onConfirm) }}>
              {confirmation?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Records_SavedViewControls_ReorderDialog
        key={views.map((savedView) => `${savedView.id}:${savedView.sortOrder}`).join('|')}
        open={isReordering}
        views={views}
        disabled={disabled}
        onOpenChange={setIsReordering}
        onReorder={onReorder}
      />
    </>
  )
}
