import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { AvatarCropper, ACCEPTED_IMAGE_TYPES, photoRejection } from '@/components/AvatarCropper'
import { Button } from '@/components/ui/button'

interface AvatarPhotoFieldProps {
  name: string
  avatarUrl: string | null
  disabled?: boolean
  upload: (blob: Blob | null) => Promise<void>
  label: 'profile' | 'organization'
}

export function AvatarPhotoField({ name, avatarUrl, disabled = false, upload, label }: AvatarPhotoFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!next) return

    const reason = photoRejection(next)
    setError(reason)
    setFile(reason ? null : next)
  }

  async function save(blob: Blob | null) {
    setBusy(true)
    try {
      await upload(blob)
      setFile(null)
      toast.success(blob ? 'Photo updated.' : 'Photo removed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the photo. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        aria-label={`Change ${label} photo`}
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        <Avatar name={name} src={avatarUrl} size="size-16" />
      </button>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => input.current?.click()}>
            {avatarUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {avatarUrl && (
            <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => void save(null)}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-text-muted">PNG, JPG, or WebP, up to 10MB. The photo is cropped to a square.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        onChange={pick}
      />
      <AvatarCropper
        key={file ? `${file.name}-${file.size}` : 'none'}
        file={file}
        onCancel={() => setFile(null)}
        onSave={(blob) => save(blob)}
        saving={busy}
      />
    </div>
  )
}
