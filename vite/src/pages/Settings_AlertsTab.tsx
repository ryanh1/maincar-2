import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useGetCallAlertSettings, useUpdateCallAlertSettings } from '@/hooks/callAlertSettings'
import { playTestRing } from '@/lib/callAlertDelivery'
import { callAlertDefaults, shouldRequestNotificationPermission, type CallAlertChannels, type CallAlertEvent, type CallAlertSettings } from '@/lib/callAlertSettings'
import { formatTimeZoneName } from '@/lib/datetime'
import { useAuth } from '@/providers/useAuth'

const EVENTS: Array<{ id: CallAlertEvent; label: string }> = [
  { id: 'incoming', label: 'Incoming call' },
  { id: 'missed', label: 'Missed call' },
  { id: 'voicemail', label: 'Voicemail' },
]
const CHANNELS: Array<{ id: keyof CallAlertChannels; label: string }> = [
  { id: 'sound', label: 'Sound' },
  { id: 'popover', label: 'Popover' },
  { id: 'browserNotification', label: 'Browser notification' },
  { id: 'desktopNotification', label: 'Desktop notification' },
]

export function Settings_AlertsTab() {
  const { user } = useAuth()
  const alertsQuery = useGetCallAlertSettings()
  const updateAlerts = useUpdateCallAlertSettings()
  const settings = alertsQuery.data?.callAlertSettings ?? callAlertDefaults
  const zone = formatTimeZoneName(new Date(), user?.timeZone)

  async function save(next: CallAlertSettings) {
    try {
      await updateAlerts.mutateAsync(next)
      toast.success('Call alerts saved.')
    } catch {
      toast.error('Could not save call alerts. Try again.')
    }
  }

  function updateChannel(event: CallAlertEvent, channel: keyof CallAlertChannels, checked: boolean) {
    const next = { ...settings, [event]: { ...settings[event], [channel]: checked } }
    if (checked && typeof Notification !== 'undefined' && shouldRequestNotificationPermission(next[event], Notification.permission)) {
      void Notification.requestPermission().then((permission) => {
        if (permission !== 'granted') toast.error('Browser notifications are blocked. Change the browser permission to enable them.')
      })
    }
    void save(next)
  }

  if (alertsQuery.isLoading) return <p className="text-sm text-text-muted">Loading call alerts.</p>
  if (alertsQuery.isError) return <p className="text-sm text-destructive">Could not load call alerts. Refresh and try again.</p>

  return (
    <section className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Call alerts</CardTitle>
          <CardDescription>Choose how this browser alerts the rep while Maincar is open.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {EVENTS.map(({ id, label }) => (
            <div key={id} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
              <h3 className="text-sm font-medium">{label}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {CHANNELS.map(({ id: channel, label: channelLabel }) => {
                  const controlId = `${id}-${channel}`
                  return <div key={channel} className="flex items-center justify-between gap-3"><Label htmlFor={controlId}>{label} {channelLabel.toLowerCase()}</Label><Switch id={controlId} checked={settings[id][channel]} disabled={updateAlerts.isPending} onCheckedChange={(checked) => updateChannel(id, channel, checked)} /></div>
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Ring and do not disturb</CardTitle><CardDescription>All schedule times use {zone}.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3"><Label htmlFor="call-alert-ring-sound" className="w-24">Ring sound</Label><Select value={settings.ringSound} onValueChange={(ringSound: CallAlertSettings['ringSound']) => void save({ ...settings, ringSound })}><SelectTrigger id="call-alert-ring-sound" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="classic">Classic</SelectItem><SelectItem value="chime">Chime</SelectItem></SelectContent></Select></div>
          <div className="flex items-center gap-3"><Label htmlFor="call-alert-volume" className="w-24">Volume</Label><Slider id="call-alert-volume" aria-label="Ring volume" className="max-w-xs" min={0} max={100} step={5} value={[settings.volume * 100]} onValueChange={([value]) => void save({ ...settings, volume: value / 100 })} /><Button type="button" size="sm" variant="secondary" onClick={() => playTestRing({ volume: settings.volume, ringSound: settings.ringSound })}>Test ring</Button></div>
          <div className="flex items-center justify-between gap-3"><Label htmlFor="dnd-enabled">Do not disturb</Label><Switch id="dnd-enabled" checked={settings.doNotDisturb.enabled} onCheckedChange={(enabled) => void save({ ...settings, doNotDisturb: { ...settings.doNotDisturb, enabled } })} /></div>
          <div className="grid max-w-md grid-cols-2 gap-3"><div><Label htmlFor="dnd-start">Starts at ({zone})</Label><Input key={settings.doNotDisturb.startTime} className="h-8" id="dnd-start" defaultValue={settings.doNotDisturb.startTime} onBlur={(event) => void save({ ...settings, doNotDisturb: { ...settings.doNotDisturb, startTime: event.target.value } })} /></div><div><Label htmlFor="dnd-end">Ends at ({zone})</Label><Input key={settings.doNotDisturb.endTime} className="h-8" id="dnd-end" defaultValue={settings.doNotDisturb.endTime} onBlur={(event) => void save({ ...settings, doNotDisturb: { ...settings.doNotDisturb, endTime: event.target.value } })} /></div></div>
        </CardContent>
      </Card>
    </section>
  )
}
