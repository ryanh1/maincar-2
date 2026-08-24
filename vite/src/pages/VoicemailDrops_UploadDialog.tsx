import { useState } from 'react'
import { FileAudio } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onUpload: (name: string, file: File) => Promise<void>
}

/** A compact file-picker dialog with the same input backing its drag-and-drop target. */
export function VoicemailDrops_UploadDialog({ open, busy, onOpenChange, onUpload }: Props) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)

  function close(): void {
    setName('')
    setFile(null)
    onOpenChange(false)
  }

  async function submit(): Promise<void> {
    if (!file || !name.trim()) return
    await onUpload(name.trim(), file)
    close()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) close()
      }}
    >
      <DialogContent showCloseButton={!busy} className="max-w-md rounded-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Upload voicemail drop</DialogTitle>
          <DialogDescription>Upload one WebM file no larger than 20MB.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit().catch(() => undefined)
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="voicemail-drop-name">Name</Label>
            <Input id="voicemail-drop-name" className="h-8" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div
            data-testid="voicemail-drop-zone"
            className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface p-6 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const dropped = event.dataTransfer.files[0]
              if (dropped) setFile(dropped)
            }}
          >
            <FileAudio size={16} aria-hidden className="text-text-muted" />
            <p className="text-sm">Drop a WebM file here</p>
            <Button size="sm" variant="secondary" asChild>
              <label htmlFor="voicemail-drop-file">Choose file</label>
            </Button>
            <input
              id="voicemail-drop-file"
              className="sr-only"
              type="file"
              accept="audio/webm,.webm"
              aria-label="Choose a WebM file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file && <p className="max-w-full truncate text-xs text-text-muted">{file.name}</p>}
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy || !file || !name.trim()}>{busy ? 'Uploading' : 'Upload voicemail drop'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
