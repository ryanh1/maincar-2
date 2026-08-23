import {
  isDoNotDisturbActive,
  type CallAlertEvent,
  type CallAlertSettings,
} from './callAlertSettings'

type Stop = () => void

function startRing(volume: number, ringSound: CallAlertSettings['ringSound'] = 'classic'): Stop {
  const AudioContextCtor = window.AudioContext
  if (!AudioContextCtor) return () => undefined
  const context = new AudioContextCtor()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = ringSound === 'chime' ? 660 : 880
  gain.gain.value = Math.max(0, Math.min(1, volume)) * 0.08
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  return () => {
    oscillator.stop()
    void context.close()
  }
}

export function playTestRing({ volume, ringSound = 'classic', start = startRing }: { volume: number; ringSound?: CallAlertSettings['ringSound']; start?: (volume: number, ringSound: CallAlertSettings['ringSound']) => Stop }) {
  const stop = start(volume, ringSound)
  const timer = window.setTimeout(stop, 3_000)
  return () => {
    window.clearTimeout(timer)
    stop()
  }
}

interface AlertArgs {
  event: CallAlertEvent
  title: string
  body: string
  settings: CallAlertSettings
  timeZone: string
  now?: string | Date
  sound?: () => Stop | void
  popover?: (title: string, options: { description: string }) => void
  nativePermission?: NotificationPermission
  nativeNotification?: (title: string, options: NotificationOptions) => void
}

/** Delivers only foreground, user-controlled alerts. It never asks for permission. */
export function deliverForegroundCallAlert({
  event, title, body, settings, timeZone, now = new Date(), sound, popover, nativePermission, nativeNotification,
}: AlertArgs): Stop {
  if (isDoNotDisturbActive(settings.doNotDisturb, now, timeZone)) return () => undefined
  const channels = settings[event]
  const stops: Stop[] = []

  if (channels.sound) {
    const stop = sound?.() ?? startRing(settings.volume, settings.ringSound)
    stops.push(stop)
  }
  if (channels.popover) popover?.(title, { description: body })
  const permission = nativePermission ?? (typeof Notification === 'undefined' ? 'denied' : Notification.permission)
  if ((channels.browserNotification || channels.desktopNotification) && permission === 'granted') {
    if (nativeNotification) nativeNotification(title, { body })
    else new Notification(title, { body })
  }
  return () => stops.forEach((stop) => stop())
}
