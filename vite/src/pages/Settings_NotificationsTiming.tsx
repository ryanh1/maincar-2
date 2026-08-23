import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useGetNotificationDeliverySettings, useUpdateNotificationDeliverySettings } from '@/hooks/notificationDeliverySettings'
import { formatTimeZoneName } from '@/lib/datetime'
import { notificationDeliveryDefaults, type DigestFrequency, type NotificationDeliverySettings, type NotificationTiming } from '@/lib/notificationDeliverySettings'
import { type NotificationChannel } from '@/lib/notificationPreferences'
import { useAuth } from '@/providers/useAuth'

const channels: Array<{ id: NotificationChannel; label: string; disabled: boolean }> = [
  { id: 'in_app', label: 'In-app inbox', disabled: true },
  { id: 'email', label: 'Email', disabled: false },
  { id: 'push', label: 'Push', disabled: false },
  { id: 'slack', label: 'Slack', disabled: true },
]

export function Settings_NotificationsTiming() {
  const { user } = useAuth()
  const settingsQuery = useGetNotificationDeliverySettings()
  const updateSettings = useUpdateNotificationDeliverySettings()
  const settings = settingsQuery.data?.notificationDeliverySettings ?? notificationDeliveryDefaults
  const zone = formatTimeZoneName(new Date(), user?.timeZone)

  async function save(next: NotificationDeliverySettings) {
    try {
      await updateSettings.mutateAsync(next)
      toast.success('Notification timing saved.')
    } catch {
      toast.error('Could not save notification timing. Check your connection and try again.')
    }
  }

  function updateChannel(channel: NotificationChannel, changes: Partial<NotificationDeliverySettings['channels'][NotificationChannel]>) {
    void save({ ...settings, channels: { ...settings.channels, [channel]: { ...settings.channels[channel], ...changes } } })
  }

  if (settingsQuery.isLoading) return <p className="text-sm text-text-muted">Loading notification timing.</p>
  if (settingsQuery.isError) return <p className="text-sm text-destructive">Could not load notification timing. Refresh and try again.</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Timing and quiet hours</CardTitle>
        <CardDescription>Choose when each channel reaches the rep. All schedule times use {zone}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {channels.map(({ id, label, disabled }) => {
            const channel = settings.channels[id]
            const timingId = `${id}-timing`
            return (
              <div key={id} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Label htmlFor={timingId} className="w-24">{label} timing</Label>
                  <Select value={channel.timing} disabled={disabled || updateSettings.isPending} onValueChange={(timing: NotificationTiming) => updateChannel(id, { timing })}>
                    <SelectTrigger id={timingId} size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Immediate</SelectItem>
                      <SelectItem value="digest">Digest</SelectItem>
                      <SelectItem value="off">Off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {channel.timing === 'digest' && !disabled && (
                  <div className="mt-3 grid max-w-md gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`${id}-digest-frequency`}>{label} digest frequency</Label>
                      <Select value={channel.digestFrequency} disabled={updateSettings.isPending} onValueChange={(digestFrequency: DigestFrequency) => updateChannel(id, { digestFrequency })}>
                        <SelectTrigger id={`${id}-digest-frequency`} size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem></SelectContent>
                      </Select>
                    </div>
                    {channel.digestFrequency === 'daily' && <div><Label htmlFor={`${id}-digest-time`}>Daily digest time ({zone})</Label><Input key={channel.digestTime} id={`${id}-digest-time`} type="time" defaultValue={channel.digestTime} disabled={updateSettings.isPending} onBlur={(event) => updateChannel(id, { digestTime: event.target.value })} /></div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3"><Label htmlFor="quiet-hours-enabled">Quiet hours</Label><Switch id="quiet-hours-enabled" checked={settings.quietHours.enabled} disabled={updateSettings.isPending} onCheckedChange={(enabled) => void save({ ...settings, quietHours: { ...settings.quietHours, enabled } })} /></div>
          <div className="grid max-w-md grid-cols-2 gap-3"><div><Label htmlFor="quiet-hours-start">Quiet hours start ({zone})</Label><Input key={settings.quietHours.startTime} id="quiet-hours-start" type="time" defaultValue={settings.quietHours.startTime} disabled={updateSettings.isPending} onBlur={(event) => void save({ ...settings, quietHours: { ...settings.quietHours, startTime: event.target.value } })} /></div><div><Label htmlFor="quiet-hours-end">Quiet hours end ({zone})</Label><Input key={settings.quietHours.endTime} id="quiet-hours-end" type="time" defaultValue={settings.quietHours.endTime} disabled={updateSettings.isPending} onBlur={(event) => void save({ ...settings, quietHours: { ...settings.quietHours, endTime: event.target.value } })} /></div></div>
          <p className="text-xs text-text-muted">During quiet hours, email and push wait for their next digest. The inbox keeps filling.</p>
        </div>
      </CardContent>
    </Card>
  )
}
