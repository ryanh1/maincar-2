import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { useGetNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/notificationPreferences'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_KINDS,
  notificationPreferenceDefaults,
  type NotificationChannel,
  type NotificationEventKind,
  type NotificationPreference,
} from '@/lib/notificationPreferences'

const eventLabels: Record<NotificationEventKind, string> = {
  mention: 'Mentions',
  assignment: 'Assignments',
  comment: 'Comments and replies',
  status_change: 'Status changes',
  team_broadcast: 'Team and broadcasts',
}

const channelLabels: Record<NotificationChannel, string> = {
  in_app: 'In-app inbox',
  email: 'Email',
  push: 'Push',
  slack: 'Slack',
}

function preferenceValue(preferences: NotificationPreference[], eventKind: NotificationEventKind, channel: NotificationChannel): boolean {
  return preferences.find((preference) => preference.eventKind === eventKind && preference.channel === channel)?.enabled ?? false
}

export function Settings_NotificationsTab() {
  const preferencesQuery = useGetNotificationPreferences()
  const updatePreferences = useUpdateNotificationPreferences()
  const preferences = preferencesQuery.data?.notificationPreferences ?? notificationPreferenceDefaults

  async function updateChannel(eventKind: NotificationEventKind, channel: NotificationChannel, enabled: boolean) {
    const next = preferences.map((preference) =>
      preference.eventKind === eventKind && preference.channel === channel ? { ...preference, enabled } : preference,
    )
    try {
      await updatePreferences.mutateAsync(next)
      toast.success('Notification settings saved.')
    } catch {
      toast.error('Could not save notification settings. Check your connection and try again.')
    }
  }

  if (preferencesQuery.isLoading) return <p className="text-sm text-text-muted">Loading notification settings.</p>
  if (preferencesQuery.isError) return <p className="text-sm text-destructive">Could not load notification settings. Refresh and try again.</p>

  return (
    <section className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Notifications</CardTitle>
          <CardDescription>Choose which delivery channels each notification group uses.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="bg-surface text-xs font-medium text-text-muted">
                <tr className="h-8 border-b border-border">
                  <th scope="col" className="px-3 text-left font-medium">Notification group</th>
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <th key={channel} scope="col" className="px-3 text-center font-medium">{channelLabels[channel]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_EVENT_KINDS.map((eventKind) => (
                  <tr key={eventKind} className="h-10 border-b border-border last:border-b-0">
                    <th scope="row" className="px-3 text-left font-medium">{eventLabels[eventKind]}</th>
                    {NOTIFICATION_CHANNELS.map((channel) => {
                      const disabled = updatePreferences.isPending || channel === 'in_app' || channel === 'slack'
                      return (
                        <td key={channel} className="px-3 py-1 text-center">
                          <Checkbox
                            aria-label={`${eventLabels[eventKind]} ${channelLabels[channel].toLowerCase()}`}
                            checked={preferenceValue(preferences, eventKind, channel)}
                            disabled={disabled}
                            onCheckedChange={(checked) => void updateChannel(eventKind, channel, checked === true)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-muted">In-app inbox stays on. Slack delivery will be available after the Slack integration ships.</p>
        </CardContent>
      </Card>
    </section>
  )
}
