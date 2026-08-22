import { useRef, useState } from 'react'
import { Mic, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  useActivateVoicemailGreeting, useDeleteVoicemailGreeting, useGetVoicemailGreeting, useUploadVoicemailGreeting,
} from '@/hooks/voicemailGreeting'
import type { VoicemailGreeting } from '@/lib/voicemailGreetingTypes'
import { useAuth } from '@/providers/useAuth'

function statusCopy(greeting: VoicemailGreeting): string {
  if (greeting.status === 'uploading') return 'Uploading greeting.'
  if (greeting.status === 'transcoding') return 'Converting greeting.'
  if (greeting.status === 'ready') return 'Ready to replace the active greeting.'
  if (greeting.status === 'failed') return greeting.failureReason ?? 'Greeting could not be prepared. Upload another file.'
  return 'Active greeting.'
}

function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

interface GreetingDraft { file: File; url: string; duration: number; start: number; end: number }

async function trimGreeting(draft: GreetingDraft): Promise<File> {
  if (draft.start === 0 && draft.end >= draft.duration) return draft.file
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await draft.file.arrayBuffer())
    const destination = context.createMediaStreamDestination()
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined)
    const chunks: BlobPart[] = []
    const result = new Promise<File>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => reject(new Error('Could not trim the greeting.'))
      recorder.onstop = () => resolve(new File([new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })], 'trimmed-voicemail-greeting.webm', { type: recorder.mimeType || 'audio/webm' }))
    })
    const source = context.createBufferSource(); source.buffer = decoded; source.connect(destination)
    recorder.start(); source.start(0, draft.start, Math.max(0.1, draft.end - draft.start))
    source.onended = () => recorder.stop()
    return await result
  } finally { await context.close() }
}

/** Settings → Voicemail greeting: candidates never replace caller-facing audio until explicitly promoted. */
export function Settings_VoicemailGreetingTab() {
  const { org, isAdmin } = useAuth()
  const greetingQuery = useGetVoicemailGreeting(org?.id)
  const upload = useUploadVoicemailGreeting()
  const activate = useActivateVoicemailGreeting()
  const remove = useDeleteVoicemailGreeting()
  const inputRef = useRef<HTMLInputElement>(null)
  const monitorRef = useRef<{ stream: MediaStream; context: AudioContext; frame: number } | null>(null)
  const [recording, setRecording] = useState<MediaRecorder | null>(null)
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null)
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [inputId, setInputId] = useState('default')
  const [meter, setMeter] = useState(0)
  const [isCheckingMic, setIsCheckingMic] = useState(false)
  const [draft, setDraft] = useState<GreetingDraft | null>(null)

  if (!org) return null
  const orgId = org.id
  if (greetingQuery.isLoading) return <p className="text-sm text-text-muted">Loading voicemail greeting.</p>
  if (greetingQuery.isError || !greetingQuery.data) return <p className="text-sm text-danger">Could not load the voicemail greeting. Refresh and try again.</p>

  const { active, candidates } = greetingQuery.data.greeting
  const disabled = !isAdmin || upload.isPending || activate.isPending || remove.isPending

  function uploadFile(file: File): void {
    upload.mutate({ orgId, file, idempotencyKey: idempotencyKey() }, {
      onSuccess: () => toast.success('Greeting uploaded. It will be ready after conversion.'),
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not upload the greeting. Try again.'),
    })
  }
  async function uploadDraft(): Promise<void> {
    if (!draft) return
    try { uploadFile(await trimGreeting(draft)); URL.revokeObjectURL(draft.url); setDraft(null) }
    catch { toast.error('Could not trim the greeting. Choose a shorter recording and try again.') }
  }

  async function startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: inputId === 'default' ? true : { deviceId: { exact: inputId } } })
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        setRecording(null); setRecordingStream(null)
        const file = new File([new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })], 'voicemail-greeting.webm', { type: recorder.mimeType || 'audio/webm' })
        setDraft({ file, url: URL.createObjectURL(file), duration: 0, start: 0, end: 0 })
      }
      recorder.start(); setRecording(recorder); setRecordingStream(stream)
    } catch {
      toast.error('Could not use the microphone. Select another input or allow microphone access.')
    }
  }

  function stopRecording(): void { recording?.stop(); recordingStream?.getTracks().forEach((track) => track.stop()) }
  function stopMicCheck(): void {
    const monitor = monitorRef.current
    if (!monitor) return
    cancelAnimationFrame(monitor.frame); monitor.stream.getTracks().forEach((track) => track.stop()); void monitor.context.close()
    monitorRef.current = null; setMeter(0); setIsCheckingMic(false)
  }
  async function checkMicrophone(): Promise<void> {
    stopMicCheck()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: inputId === 'default' ? true : { deviceId: { exact: inputId } } })
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')
      setInputs(devices)
      const context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      const values = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(values)
        setMeter(Math.round(values.reduce((sum, value) => sum + Math.abs(value - 128), 0) / values.length / 128 * 100))
        if (monitorRef.current) monitorRef.current.frame = requestAnimationFrame(tick)
      }
      monitorRef.current = { stream, context, frame: requestAnimationFrame(tick) }
      setIsCheckingMic(true)
    } catch { toast.error('Could not check the microphone. Select another input or allow microphone access.') }
  }
  function activateGreeting(greeting: VoicemailGreeting): void {
    activate.mutate({ orgId, greetingId: greeting.id }, {
      onSuccess: () => toast.success('Voicemail greeting replaced.'),
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not replace the greeting. Try again.'),
    })
  }
  function deleteGreeting(greeting: VoicemailGreeting): void {
    remove.mutate({ orgId, greetingId: greeting.id }, {
      onSuccess: () => toast.success('Voicemail greeting deleted.'),
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not delete the greeting. Try again.'),
    })
  }

  return <section className="max-w-2xl" aria-labelledby="voicemail-greeting-title">
    <h2 id="voicemail-greeting-title" className="text-sm font-semibold">Voicemail greeting</h2>
    <p className="mt-1 text-xs text-text-muted">Callers hear the active greeting until you replace or delete it.</p>
    <div className="mt-4 border border-border bg-bg p-4">
      <div className="flex flex-col gap-3">
        <div><p className="text-sm font-medium">Default greeting</p><p className="text-xs text-text-muted">Use this when there is no active personal greeting.</p></div>
        {active ? <GreetingCard greeting={active} label="Active voicemail greeting" disabled={disabled} onDelete={deleteGreeting} /> : <p className="text-sm text-text-muted">The default greeting is active.</p>}
        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium">Personal greeting</p>
          <p className="mt-1 text-xs text-text-muted">Record or upload a WebM or MP3 file up to 20MB.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-56"><Label htmlFor="voicemail-microphone">Microphone</Label><Select value={inputId} onValueChange={setInputId}><SelectTrigger id="voicemail-microphone" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Default microphone</SelectItem>{inputs.map((input, index) => <SelectItem key={input.deviceId} value={input.deviceId}>{input.label || `Microphone ${index + 1}`}</SelectItem>)}</SelectContent></Select></div>
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => void checkMicrophone()}>{isCheckingMic ? 'Checking microphone' : 'Check microphone'}</Button>
            {isCheckingMic ? <Button type="button" variant="ghost" size="sm" onClick={stopMicCheck}>Stop check</Button> : null}
          </div>
          <div className="mt-2"><progress className="h-2 w-full accent-primary" aria-label="Microphone level" value={meter} max={100} /><p className="mt-1 text-xs text-text-muted">{isCheckingMic ? 'Speak to verify the microphone meter moves.' : 'Check the microphone before recording.'}</p></div>
          <input ref={inputRef} className="sr-only" type="file" accept="audio/webm,audio/mpeg,audio/mp3" aria-label="Upload a greeting" onChange={(event) => {
            const file = event.target.files?.[0]; event.currentTarget.value = ''
            if (file) { if (draft) URL.revokeObjectURL(draft.url); setDraft({ file, url: URL.createObjectURL(file), duration: 0, start: 0, end: 0 }) }
          }} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}><Upload size={16} aria-hidden />Upload greeting</Button>
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => recording ? stopRecording() : void startRecording()}><Mic size={16} aria-hidden />{recording ? 'Stop recording' : 'Record greeting'}</Button>
          </div>
          {draft ? <div className="mt-3 border border-border bg-surface p-3"><p className="text-xs font-medium text-text-muted">Preview candidate</p><audio controls src={draft.url} className="mt-2 w-full" aria-label="Greeting candidate preview" onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) setDraft((current) => current ? { ...current, duration, end: duration } : null) }}>Your browser cannot play this greeting.</audio>{draft.duration > 0 ? <div className="mt-3 flex flex-col gap-3"><div><Label>Start</Label><Slider aria-label="Greeting trim start" min={0} max={draft.end} step={0.1} value={[draft.start]} onValueChange={([start]) => setDraft((current) => current ? { ...current, start: start ?? 0 } : null)} /></div><div><Label>End</Label><Slider aria-label="Greeting trim end" min={draft.start} max={draft.duration} step={0.1} value={[draft.end]} onValueChange={([end]) => setDraft((current) => current ? { ...current, end: end ?? current.duration } : null)} /></div></div> : null}<div className="mt-3 flex gap-2"><Button type="button" size="sm" disabled={disabled || draft.duration === 0} onClick={() => void uploadDraft()}>Upload candidate</Button><Button type="button" variant="ghost" size="sm" onClick={() => { URL.revokeObjectURL(draft.url); setDraft(null) }}>Discard candidate</Button></div></div> : null}
          {!isAdmin ? <p className="mt-3 text-xs text-text-muted">Only an admin can change the voicemail greeting.</p> : null}
        </div>
        {candidates.map((candidate) => <CandidateCard key={candidate.id} greeting={candidate} disabled={disabled} onActivate={activateGreeting} onDelete={deleteGreeting} />)}
      </div>
    </div>
  </section>
}

function GreetingCard({ greeting, label, disabled, onDelete }: { greeting: VoicemailGreeting; label: string; disabled: boolean; onDelete: (greeting: VoicemailGreeting) => void }) {
  return <div className="border border-border bg-surface p-3"><p className="text-xs font-medium text-text-muted">{label}</p>{greeting.audioUrl ? <audio controls src={greeting.audioUrl} className="mt-2 w-full" aria-label={label}>Your browser cannot play this greeting.</audio> : null}<p className="mt-2 text-xs text-text-muted">{statusCopy(greeting)}</p><DeleteGreetingDialog greeting={greeting} disabled={disabled} onDelete={onDelete} label="Delete active greeting" /></div>
}

function CandidateCard({ greeting, disabled, onActivate, onDelete }: { greeting: VoicemailGreeting; disabled: boolean; onActivate: (greeting: VoicemailGreeting) => void; onDelete: (greeting: VoicemailGreeting) => void }) {
  const canActivate = greeting.status === 'ready'
  return <div className="border border-border bg-surface p-3"><p className="text-xs font-medium text-text-muted">Candidate</p>{greeting.audioUrl ? <audio controls src={greeting.audioUrl} className="mt-2 w-full" aria-label="Candidate voicemail greeting">Your browser cannot play this greeting.</audio> : null}<p className={greeting.status === 'failed' ? 'mt-2 text-xs text-danger' : 'mt-2 text-xs text-text-muted'}>{statusCopy(greeting)}</p><div className="mt-3 flex flex-wrap gap-2">{canActivate ? <ActivateGreetingDialog greeting={greeting} disabled={disabled} onActivate={onActivate} /> : null}<DeleteGreetingDialog greeting={greeting} disabled={disabled} onDelete={onDelete} label={greeting.status === 'failed' ? 'Delete failed greeting' : 'Delete candidate greeting'} /></div></div>
}

function ActivateGreetingDialog({ greeting, disabled, onActivate }: { greeting: VoicemailGreeting; disabled: boolean; onActivate: (greeting: VoicemailGreeting) => void }) { return <AlertDialog><AlertDialogTrigger asChild><Button type="button" size="sm" disabled={disabled}>Replace active greeting</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Replace the active greeting?</AlertDialogTitle><AlertDialogDescription>The current greeting stays active until you confirm this replacement.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={disabled} onClick={(event) => { event.preventDefault(); onActivate(greeting) }}>Replace greeting</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> }

function DeleteGreetingDialog({ greeting, disabled, onDelete, label }: { greeting: VoicemailGreeting; disabled: boolean; onDelete: (greeting: VoicemailGreeting) => void; label: string }) { return <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="destructive" size="sm" disabled={disabled}><Trash2 size={16} aria-hidden />{label}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this voicemail greeting?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={disabled} onClick={(event) => { event.preventDefault(); onDelete(greeting) }}>Delete greeting</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> }
