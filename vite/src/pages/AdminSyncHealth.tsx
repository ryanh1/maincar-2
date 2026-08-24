import { Activity } from 'lucide-react'

import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useGetAdminSyncHealth } from '@/hooks/admin'
import { formatDateTime } from '@/lib/datetime'
import { useAuth } from '@/providers/useAuth'

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Never'
  const absolute = Math.abs(seconds)
  if (absolute < 60) return `${absolute}s`
  if (absolute < 3_600) return `${Math.floor(absolute / 60)}m`
  if (absolute < 86_400) return `${Math.floor(absolute / 3_600)}h`
  return `${Math.floor(absolute / 86_400)}d`
}

function formatPercent(value: number | null): string {
  return value === null ? 'No data' : new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value)
}

function queueLabel(value: string): string {
  return value.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function subscriptionLabel(value: string): string {
  const labels: Record<string, string> = {
    google_mail: 'Gmail watch',
    google_calendar: 'Google Calendar watch',
    microsoft_mail: 'Microsoft mail subscription',
    microsoft_calendar: 'Microsoft calendar subscription',
  }
  return labels[value] ?? value
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function DataRow({ primary, secondary, value }: { primary: string; secondary?: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{primary}</div>
        {secondary ? <div className="text-xs text-text-muted">{secondary}</div> : null}
      </div>
      <div className="shrink-0 text-right tabular-nums">{value}</div>
    </div>
  )
}

export function AdminSyncHealth() {
  const { user } = useAuth()
  const health = useGetAdminSyncHealth()

  if (health.isLoading) {
    return (
      <Card>
        <CardContent className="text-sm">Loading sync health…</CardContent>
      </Card>
    )
  }
  if (health.isError || !health.data) {
    return (
      <Card>
        <CardContent className="text-sm">Could not load sync health. Refresh the page.</CardContent>
      </Card>
    )
  }

  const report = health.data.syncHealth
  const zone = user?.timeZone

  return (
    <section className="flex flex-col gap-6">
      <PageHeader icon={Activity} title="Sync health" />
      <p className="text-xs text-text-muted">
        Updated {formatDateTime(report.generatedAt, zone)} · rolling {report.windowHours}-hour rates
      </p>

      <Card>
        <CardHeader><CardTitle className="text-sm"><h2>F-job queues</h2></CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          {report.queues.map((queue) => (
            <DataRow
              key={queue.queue}
              primary={queueLabel(queue.queue)}
              secondary={`Failures ${queue.failureCount} · dead-letter ${queue.deadLetterCount}`}
              value={`${queue.queueDepth} queued`}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm"><h2>Cursor age per account</h2></CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          {report.accounts.length === 0 ? <div className="py-2 text-sm">Connect a mailbox to begin monitoring.</div> : null}
          {report.accounts.map((account) => (
            <DataRow
              key={account.id}
              primary={account.emailAddress}
              secondary={account.lastSyncedAt
                ? `${account.orgName ?? account.orgId} · ${formatDateTime(account.lastSyncedAt, zone)}`
                : account.orgName ?? account.orgId}
              value={account.cursorAgeSeconds === null ? 'Never synced' : `${formatDuration(account.cursorAgeSeconds)} old`}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm"><h2>Full resync and match rates</h2></CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          {report.accounts.map((account) => (
            <DataRow
              key={account.id}
              primary={account.emailAddress}
              secondary={`${countLabel(account.fullResyncs, 'full resync')} across ${countLabel(account.syncRuns, 'poll')} · ${account.messagesMatched}/${account.messagesScanned} messages matched`}
              value={`${formatPercent(account.fullResyncRate)} resync · ${formatPercent(account.matchRate)} match`}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm"><h2>Push-subscription expiry</h2></CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          {report.subscriptions.length === 0 ? <div className="py-2 text-sm">No push subscriptions are active.</div> : null}
          {report.subscriptions.map((subscription) => (
            <DataRow
              key={`${subscription.mailAccountId}:${subscription.kind}`}
              primary={`${subscription.emailAddress} · ${subscriptionLabel(subscription.kind)}`}
              secondary={formatDateTime(subscription.expiresAt, zone)}
              value={subscription.expiresInSeconds < 0
                ? `Expired ${formatDuration(subscription.expiresInSeconds)} ago`
                : `Expires in ${formatDuration(subscription.expiresInSeconds)}`}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm"><h2>Unmatched hold buffer</h2></CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          {report.holdBuffer.byOrg.length === 0 ? <div className="py-2 text-sm">The hold buffer is empty.</div> : null}
          {report.holdBuffer.byOrg.map((org) => (
            <DataRow
              key={org.orgId}
              primary={org.orgName ?? org.orgId}
              value={`${org.count} held`}
            />
          ))}
          <DataRow primary="All organizations" value={`${report.holdBuffer.total} held`} />
        </CardContent>
      </Card>
    </section>
  )
}
