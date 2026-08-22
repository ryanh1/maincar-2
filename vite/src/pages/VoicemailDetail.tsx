import { useState } from 'react'
import { ArrowLeft, Check, Copy, Download, Phone, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/PageHeader'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useDeleteVoicemail, useGetVoicemail } from '@/hooks/voicemail'
import type { Voicemail } from '@/hooks/voicemail'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/datetime'
import { formatElapsed } from '@/lib/duration'
import { useAuth } from '@/providers/useAuth'

/** A single inbound voicemail, with playback, transcript, and a deliberate delete flow. */
export function VoicemailDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, org } = useAuth()
  const voicemailQuery = useGetVoicemail(org?.id, id)
  const deleteVoicemail = useDeleteVoicemail()
  const voicemail = voicemailQuery.data?.voicemail

  function deleteCurrentVoicemail(): void {
    if (!org?.id || !id) return
    deleteVoicemail.mutate(
      { orgId: org.id, id },
      {
        onSuccess: () => {
          toast.success('Voicemail deleted.')
          navigate('/voicemails')
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : 'Could not delete the voicemail. Try again.',
          ),
      },
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader icon={Phone} title="Voicemail" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <Button variant="ghost" size="sm" className="self-start" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} aria-hidden />
          Back to inbox
        </Button>

        {voicemailQuery.isPending && <LoadingState />}
        {voicemailQuery.isError && (
          <div className="flex items-center gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-destructive">Could not load this voicemail. Try again.</p>
            <Button variant="secondary" size="sm" onClick={() => void voicemailQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {voicemail && (
          <VoicemailBody
            voicemail={voicemail}
            timeZone={user?.timeZone}
            deleting={deleteVoicemail.isPending}
            onDelete={deleteCurrentVoicemail}
          />
        )}
      </main>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

function VoicemailBody({
  voicemail,
  timeZone,
  deleting,
  onDelete,
}: {
  voicemail: Voicemail
  timeZone: string | null | undefined
  deleting: boolean
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <VoicemailFacts voicemail={voicemail} timeZone={timeZone} />
      <TranscriptSection voicemail={voicemail} />
      <RecordingSection voicemail={voicemail} />
      <DeleteVoicemailDialog deleting={deleting} onDelete={onDelete} />
    </div>
  )
}

function VoicemailFacts({ voicemail, timeZone }: { voicemail: Voicemail; timeZone: string | null | undefined }) {
  const facts = [
    { label: 'From', value: voicemail.fromE164, numeric: true },
    { label: 'To', value: voicemail.toE164, numeric: true },
    { label: 'Duration', value: voicemail.durationS === null ? '—' : formatElapsed(voicemail.durationS), numeric: true },
    { label: 'Received', value: formatDateTime(voicemail.createdAt, timeZone) },
  ]

  return (
    <div className="rounded-md border border-border p-4">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className={fact.numeric ? 'text-sm tabular-nums' : 'text-sm'}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function TranscriptSection({ voicemail }: { voicemail: Voicemail }) {
  const transcript = voicemail.transcriptStatus === 'done' ? (voicemail.transcript ?? '') : ''
  const hasTranscript = transcript.trim() !== ''

  return (
    <section className="rounded-md border border-border p-4" aria-labelledby="transcript-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="transcript-title" className="text-sm font-semibold">Transcript</h2>
        {hasTranscript && <CopyTranscriptButton text={transcript} />}
      </div>
      <p className="mt-3 text-sm whitespace-pre-wrap">{hasTranscript ? transcript : transcriptMessage(voicemail.transcriptStatus)}</p>
    </section>
  )
}

function transcriptMessage(status: Voicemail['transcriptStatus']): string {
  if (status === 'pending') return 'Transcribing…'
  if (status === 'failed') return 'The transcript could not be generated.'
  return 'No speech was transcribed.'
}

function CopyTranscriptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy the transcript. Copy it by hand.')
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()}>
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      Copy transcript
    </Button>
  )
}

function RecordingSection({ voicemail }: { voicemail: Voicemail }) {
  return (
    <section className="rounded-md border border-border p-4" aria-labelledby="recording-title">
      <h2 id="recording-title" className="text-sm font-semibold">Recording</h2>
      {voicemail.recordingUrl ? (
        <div className="mt-3 flex flex-col gap-3">
          <audio controls src={voicemail.recordingUrl} className="w-full" aria-label={`Recording from ${voicemail.fromE164}`}>
            Your browser cannot play this recording.
          </audio>
          <div>
            <Button asChild variant="secondary" size="sm">
              <a href={voicemail.recordingUrl} download>
                <Download size={16} aria-hidden />
                Download recording
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">The recording is still being prepared.</p>
      )}
    </section>
  )
}

function DeleteVoicemailDialog({ deleting, onDelete }: { deleting: boolean; onDelete: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="self-start">
          <Trash2 size={16} aria-hidden />
          Delete voicemail
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this voicemail?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault()
              onDelete()
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
