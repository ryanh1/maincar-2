import { useCallback, useEffect, useRef, useState } from 'react'

import type { AudioDevice, UseGetDevicesResult } from './types'

// Every message names the next action, per .claude/rules/copy.md.
const NO_MEDIA_DEVICES =
  'This browser cannot reach your microphone. Open Maincar over https in Chrome, Edge, Safari, or Firefox.'
const PERMISSION_DENIED =
  'Maincar needs your microphone to make calls. Allow microphone access in your browser settings, then try again.'
const NO_MICROPHONE = 'No microphone found. Plug one in, then try again.'
const ENUMERATE_FAILED = 'Could not read your audio devices. Reconnect your headset and try again.'

function toAudioDevice(device: MediaDeviceInfo): AudioDevice {
  return { deviceId: device.deviceId, label: device.label, groupId: device.groupId }
}

/**
 * The microphones and speakers this browser can see.
 *
 * Reads hardware, not the API, so it is plain state and effects rather than a
 * React Query hook. It prompts for microphone permission on first read, then
 * re-reads whenever the OS reports a device change.
 */
export function useGetDevices(): UseGetDevicesResult {
  const [microphones, setMicrophones] = useState<AudioDevice[]>([])
  const [speakers, setSpeakers] = useState<AudioDevice[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isMountedRef = useRef(true)
  const permissionGrantedRef = useRef(false)
  const loadIdRef = useRef(0)

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current
    // Drop a result that landed after unmount, or after a newer read started.
    const commit = (apply: () => void) => {
      if (isMountedRef.current && loadId === loadIdRef.current) apply()
    }
    const fail = (message: string) => {
      commit(() => {
        setMicrophones([])
        setSpeakers([])
        setError(message)
        setIsLoading(false)
      })
    }

    const media = navigator.mediaDevices
    if (!media?.enumerateDevices) {
      // No mediaDevices at all: a page served over plain http, an old browser, or
      // an embedded webview. Say so rather than throwing on undefined.
      fail(NO_MEDIA_DEVICES)
      return
    }

    commit(() => {
      setIsLoading(true)
      setError(null)
    })

    let warning: string | null = null
    if (!permissionGrantedRef.current) {
      try {
        // enumerateDevices() returns entries with empty `label` strings until the
        // page holds microphone permission, so prompt first.
        const stream = await media.getUserMedia({ audio: true })
        // Then release the microphone immediately. A live track keeps the
        // browser's recording indicator lit and holds the device captured for as
        // long as the page lives. The stream was only ever a permission prompt.
        stream.getTracks().forEach((track) => track.stop())
        permissionGrantedRef.current = true
      } catch (err) {
        const name = (err as DOMException | undefined)?.name
        if (name !== 'NotFoundError' && name !== 'DevicesNotFoundError') {
          fail(PERMISSION_DENIED)
          return
        }
        // No input hardware is not a permission failure. Outputs may still exist,
        // so keep going and enumerate; labels stay empty without a grant.
        warning = NO_MICROPHONE
      }
    }

    try {
      const devices = await media.enumerateDevices()
      commit(() => {
        setMicrophones(devices.filter((d) => d.kind === 'audioinput').map(toAudioDevice))
        // Firefox does not expose 'audiooutput' devices at all, so an empty
        // speaker list is normal there and is not an error.
        setSpeakers(devices.filter((d) => d.kind === 'audiooutput').map(toAudioDevice))
        setError(warning)
        setIsLoading(false)
      })
    } catch {
      fail(ENUMERATE_FAILED)
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    void load()

    const media = navigator.mediaDevices
    const onDeviceChange = () => void load()
    media?.addEventListener?.('devicechange', onDeviceChange)

    return () => {
      isMountedRef.current = false
      media?.removeEventListener?.('devicechange', onDeviceChange)
    }
  }, [load])

  const refetch = useCallback(() => void load(), [load])

  return { microphones, speakers, isLoading, error, refetch }
}
