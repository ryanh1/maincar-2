import { useState } from 'react'
import { Pencil, Star, Trash2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { formatElapsed } from '@/lib/duration'
import type { VoicemailDrop } from '@/lib/voicemailDropTypes'

interface Props {
  drop: VoicemailDrop
  busy: boolean
  onRename: (dropId: string, name: string) => Promise<void>
  onSetDefault: (dropId: string) => Promise<void>
  onDelete: (dropId: string) => Promise<void>
}

function transcriptLabel(drop: VoicemailDrop): string {
  if (drop.transcriptStatus === 'pending') return 'Transcribing…'
  if (drop.transcriptStatus === 'failed') return 'Transcript failed'
  return drop.transcript || 'No speech was transcribed.'
}

/** One library row: playback, inline naming, default selection, and guarded deletion. */
export function VoicemailDrops_Row({ drop, busy, onRename, onSetDefault, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(drop.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const audioId = `voicemail-drop-audio-${drop.id}`

  async function play(): Promise<void> {
    const audio = document.getElementById(audioId) as HTMLAudioElement | null
    if (!audio || !drop.audioUrl) return
    try {
      await audio.play()
    } catch {
      toast.error('Could not play the voicemail drop. Refresh the page and try again.')
    }
  }

  async function rename(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || trimmed === drop.name) {
      setName(drop.name)
      setEditing(false)
      return
    }
    await onRename(drop.id, trimmed)
    setEditing(false)
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-1 text-sm">
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void rename().catch(() => undefined)
            }}
          >
            <Input
              autoFocus
              className="h-8 min-w-48"
              aria-label={`Name for ${drop.name}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>Save name</Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setName(drop.name)
                setEditing(false)
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <Button type="button" size="sm" variant="ghost" disabled={!drop.audioUrl} onClick={() => void play()}>
              {drop.name}
            </Button>
            <audio
              id={audioId}
              src={drop.audioUrl ?? undefined}
              preload="metadata"
              className="sr-only"
              aria-label={`Audio for ${drop.name}`}
            />
          </>
        )}
      </td>
      <td className="px-3 py-1 text-sm tabular-nums">{formatElapsed(drop.duration)}</td>
      <td className="max-w-md truncate px-3 py-1 text-sm">{transcriptLabel(drop)}</td>
      <td className="px-3 py-1 text-sm">
        {drop.isDefault ? (
          <span className="inline-flex items-center gap-2 font-medium text-primary">
            <Star size={16} aria-hidden className="fill-current" />
            Default
          </span>
        ) : (
          <IconButton tooltip={`Make ${drop.name} the default voicemail drop`} disabled={busy} onClick={() => void onSetDefault(drop.id)}>
            <Star size={16} aria-hidden />
          </IconButton>
        )}
      </td>
      <td className="px-2 py-1 text-right">
        <div className="flex justify-end gap-2">
          <IconButton tooltip={`Rename ${drop.name}`} disabled={busy} onClick={() => setEditing(true)}>
            <Pencil size={16} aria-hidden />
          </IconButton>
          <IconButton tooltip={`Delete ${drop.name}`} disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} aria-hidden />
          </IconButton>
        </div>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent className="rounded-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm">Delete {drop.name}?</AlertDialogTitle>
              <AlertDialogDescription>This removes the audio and transcript. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm" disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault()
                  void onDelete(drop.id)
                    .then(() => setConfirmDelete(false))
                    .catch(() => undefined)
                }}
              >
                Delete drop
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  )
}
