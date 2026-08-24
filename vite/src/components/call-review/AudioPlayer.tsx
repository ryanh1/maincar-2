import { useCallback, useEffect, useRef, useState } from 'react'
import { FastForward, Pause, Play, Rewind, Volume2, VolumeX } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { formatElapsed } from '@/lib/duration'
import type { CallMediaSource, ReviewLifecycleState } from '@/lib/callTypes'
import { SpeakerRibbon, type SpeakerRibbonCommentPin, type SpeakerRibbonSearchTick, type SpeakerRibbonSpeaker, type SpeakerRibbonTimeRange } from '@/components/call-review/SpeakerRibbon'
import type { SpeakerRibbonSegment } from '@/lib/speakerRibbon'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5] as const
const SEEK_SECONDS = 15

export type AudioMediaSource = CallMediaSource & { kind: 'audio' }

type PlayerStatus = 'loading' | 'ready' | 'buffering' | 'error'

export interface AudioPlayerProps {
  source: AudioMediaSource
  recordingState: ReviewLifecycleState
  callLabel: string
  segments?: readonly SpeakerRibbonSegment[]
  speakers?: readonly SpeakerRibbonSpeaker[]
  selectionRange?: SpeakerRibbonTimeRange | null
  searchTicks?: readonly SpeakerRibbonSearchTick[]
  commentPins?: readonly SpeakerRibbonCommentPin[]
  seekRequest?: { atMs: number; sequence: number } | null
  onSeek?: (time: number) => void
  onTimeChange?: (time: number) => void
}

function isEditorFocused(): boolean {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return false
  return activeElement.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName) || activeElement.getAttribute('role') === 'textbox'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rateLabel(rate: number): string {
  return `${rate}×`
}

function readBufferedRanges(audio: HTMLAudioElement): SpeakerRibbonTimeRange[] {
  return Array.from({ length: audio.buffered.length }, (_, index) => ({
    start: audio.buffered.start(index),
    end: audio.buffered.end(index),
  }))
}

/** Compact audio-only playback controls; the source contract intentionally leaves room for later video. */
export function AudioPlayer({ source, recordingState, callLabel, segments = [], speakers = [], selectionRange = null, searchTicks = [], commentPins = [], seekRequest = null, onSeek, onTimeChange }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [status, setStatus] = useState<PlayerStatus>('loading')
  const [bufferedRanges, setBufferedRanges] = useState<SpeakerRibbonTimeRange[]>([])

  const setTime = useCallback((nextTime: number) => {
    const audio = audioRef.current
    if (!audio) return
    const max = Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY
    const safeTime = clamp(nextTime, 0, Math.max(0, max))
    audio.currentTime = safeTime
    setCurrentTime(safeTime)
    onSeek?.(safeTime)
    onTimeChange?.(safeTime)
  }, [onSeek, onTimeChange])

  const seekBy = useCallback((seconds: number) => setTime((audioRef.current?.currentTime ?? currentTime) + seconds), [currentTime, setTime])

  const updateVolume = useCallback((nextVolume: number) => {
    const audio = audioRef.current
    const safeVolume = clamp(nextVolume, 0, 1)
    if (audio) {
      audio.volume = safeVolume
      audio.muted = safeVolume === 0
    }
    setVolume(safeVolume)
    setIsMuted(safeVolume === 0)
  }, [])

  const setRate = useCallback((nextRate: number) => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = nextRate
    setPlaybackRate(nextRate)
  }, [])

  const changeRate = useCallback((direction: -1 | 1) => {
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number])
    const nextIndex = clamp(currentIndex + direction, 0, PLAYBACK_RATES.length - 1)
    setRate(PLAYBACK_RATES[nextIndex] ?? 1)
  }, [playbackRate, setRate])

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setStatus('error')
      }
      return
    }
    audio.pause()
  }, [])

  const toggleMuted = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = !audio.muted
    setIsMuted(audio.muted)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    setStatus('loading')
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setBufferedRanges([])
  }, [source.url])

  useEffect(() => {
    if (seekRequest) setTime(seekRequest.atMs / 1_000)
  }, [seekRequest, setTime])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditorFocused()) return
      switch (event.key) {
        case ' ':
          event.preventDefault()
          void togglePlayback()
          break
        case 'ArrowLeft':
          event.preventDefault()
          seekBy(-SEEK_SECONDS)
          break
        case 'ArrowRight':
          event.preventDefault()
          seekBy(SEEK_SECONDS)
          break
        case 'ArrowUp':
          event.preventDefault()
          updateVolume(volume + 0.1)
          break
        case 'ArrowDown':
          event.preventDefault()
          updateVolume(volume - 0.1)
          break
        case 'm':
        case 'M':
          event.preventDefault()
          toggleMuted()
          break
        case ',':
          event.preventDefault()
          changeRate(-1)
          break
        case '.':
          event.preventDefault()
          changeRate(1)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [changeRate, seekBy, toggleMuted, togglePlayback, updateVolume, volume])

  if (recordingState === 'queued') return <p className="text-sm text-text-muted">Recording is queued.</p>
  if (recordingState === 'processing') return <p className="text-sm text-text-muted">Recording is processing.</p>
  if (recordingState === 'failed' || recordingState === 'missing') return <p className="text-sm text-danger">Recording could not be prepared. Refresh the call and try again.</p>

  const maximum = Math.max(0, duration)

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        src={source.url}
        preload="metadata"
        aria-label={`Recording of the call to ${callLabel}`}
        className="sr-only"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration
          if (Number.isFinite(nextDuration)) setDuration(nextDuration)
          setBufferedRanges(readBufferedRanges(event.currentTarget))
          setStatus('ready')
        }}
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration
          if (Number.isFinite(nextDuration)) setDuration(nextDuration)
          setBufferedRanges(readBufferedRanges(event.currentTarget))
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime)
          onTimeChange?.(event.currentTarget.currentTime)
          setBufferedRanges(readBufferedRanges(event.currentTarget))
        }}
        onProgress={(event) => setBufferedRanges(readBufferedRanges(event.currentTarget))}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onPlaying={() => { setIsPlaying(true); setStatus('ready') }}
        onWaiting={() => setStatus('buffering')}
        onCanPlay={() => setStatus('ready')}
        onError={() => setStatus('error')}
      >
        Your browser cannot play this recording.
      </audio>

      <div className="flex items-center gap-2">
        <IconButton tooltip="Skip backward 15 seconds" onClick={() => seekBy(-SEEK_SECONDS)} disabled={status === 'error'}><Rewind size={16} aria-hidden /></IconButton>
        <IconButton tooltip={isPlaying ? 'Pause recording' : 'Play recording'} onClick={() => void togglePlayback()} disabled={status === 'error'}>{isPlaying ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}</IconButton>
        <IconButton tooltip="Skip forward 15 seconds" onClick={() => seekBy(SEEK_SECONDS)} disabled={status === 'error'}><FastForward size={16} aria-hidden /></IconButton>
        <span className="text-xs tabular-nums text-text-muted">{formatElapsed(currentTime)} / {formatElapsed(maximum)}</span>
      </div>

      <Slider aria-label="Seek recording" min={0} max={maximum || 1} step={0.1} value={[Math.min(currentTime, maximum || 1)]} onValueChange={([next]) => setTime(next ?? 0)} disabled={status === 'error' || maximum === 0} />

      <div className="flex flex-wrap items-center gap-2">
        <IconButton tooltip={isMuted ? 'Unmute recording' : 'Mute recording'} onClick={toggleMuted} disabled={status === 'error'}>{isMuted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}</IconButton>
        <div className="w-24"><Slider aria-label="Recording volume" min={0} max={1} step={0.05} value={[isMuted ? 0 : volume]} onValueChange={([next]) => updateVolume(next ?? 0)} disabled={status === 'error'} /></div>
        <Select value={String(playbackRate)} onValueChange={(value) => setRate(Number(value))}>
          <SelectTrigger size="sm" aria-label="Playback speed"><SelectValue /></SelectTrigger>
          <SelectContent>{PLAYBACK_RATES.map((rate) => <SelectItem key={rate} value={String(rate)}>{rateLabel(rate)}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <p role="status" className={status === 'error' ? 'text-xs text-danger' : 'text-xs text-text-muted'}>
        {status === 'loading' && 'Loading recording…'}
        {status === 'buffering' && 'Buffering recording…'}
        {status === 'error' && 'Recording could not play. Refresh the call and try again.'}
      </p>
      <SpeakerRibbon
        duration={maximum}
        currentTime={currentTime}
        segments={segments}
        speakers={speakers}
        bufferedRanges={bufferedRanges}
        playedRanges={currentTime > 0 ? [{ start: 0, end: currentTime }] : []}
        selectionRange={selectionRange}
        searchTicks={searchTicks}
        commentPins={commentPins}
        onSeek={setTime}
      />
    </div>
  )
}
