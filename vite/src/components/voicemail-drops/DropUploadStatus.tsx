import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'

export type DropUploadState = 'uploading' | 'transcoding' | 'transcribing' | 'ready' | 'failed'

export interface DropUploadStatusProps {
  status: DropUploadState
  /** Upload percentage reported by XMLHttpRequest. Values are kept in the 0–100 range for the UI. */
  progress?: number
  /** A server or upload error that already tells the rep how to recover. */
  error?: string | null
  /** Retries a failed upload. The library owns the transport and supplies this action. */
  onRetry: () => void
  /** Cancels an active upload. The library owns the transport and supplies this action. */
  onCancel: () => void
}

const STATUS_COPY: Record<Exclude<DropUploadState, 'failed'>, string> = {
  uploading: 'Uploading',
  transcoding: 'Transcoding',
  transcribing: 'Transcribing',
  ready: 'Ready',
}

function uploadProgress(progress: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round(progress ?? 0)))
}

/**
 * Reports the lifecycle of one voicemail-drop upload. The library page owns the
 * request and polling; this component only presents the current known state and
 * forwards its two recoverable actions.
 */
export function DropUploadStatus({
  status,
  progress,
  error,
  onRetry,
  onCancel,
}: DropUploadStatusProps) {
  if (status === 'failed') {
    return (
      <div className="flex items-start gap-2 text-sm text-status-failed" role="alert">
        <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <span className="font-medium">Failed</span>
          <span>{error ?? 'The upload could not be completed. Check the file and try again.'}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry upload</Button>
        </div>
      </div>
    )
  }

  if (status === 'ready') {
    return (
      <p className="flex items-center gap-2 text-sm text-status-success">
        <CheckCircle2 size={16} aria-hidden="true" className="shrink-0" />
        <span>{STATUS_COPY.ready}</span>
      </p>
    )
  }

  if (status === 'uploading') {
    const value = uploadProgress(progress)

    return (
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-2 text-status-active">
          <span className="flex items-center gap-2">
            <LoaderCircle size={16} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
            <span>{STATUS_COPY.uploading}</span>
          </span>
          <span className="tabular-nums">{value}%</span>
        </div>
        <div
          aria-label="Upload progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={value}
          className="h-2 overflow-hidden rounded-md bg-surface-2"
          role="progressbar"
        >
          <div className="h-full bg-status-active transition-[width] duration-150 ease-out motion-reduce:transition-none" style={{ width: `${value}%` }} />
        </div>
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={onCancel}>Cancel upload</Button>
      </div>
    )
  }

  return (
    <p className="flex items-center gap-2 text-sm text-status-pending">
      <LoaderCircle size={16} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
      <span>{STATUS_COPY[status]}</span>
    </p>
  )
}
