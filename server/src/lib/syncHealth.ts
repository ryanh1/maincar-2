import prisma from '../db.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { getSyncQueueHealth, type SyncQueueHealth } from '../jobs/queue.js'

export const SYNC_HEALTH_WINDOW_HOURS = 24

type Db = Pick<
  PrismaClient,
  'mailAccount' | 'mailSyncHealthSample' | 'unmatchedActivity' | 'org'
>

type QueueReader = () => Promise<SyncQueueHealth[]>

export interface SyncHealthReport {
  generatedAt: string
  windowHours: number
  queues: SyncQueueHealth[]
  accounts: Array<{
    id: string
    orgId: string
    orgName: string | null
    emailAddress: string
    provider: string
    lastSyncedAt: string | null
    cursorAgeSeconds: number | null
    syncRuns: number
    fullResyncs: number
    fullResyncRate: number | null
    messagesScanned: number
    messagesMatched: number
    matchRate: number | null
  }>
  subscriptions: Array<{
    mailAccountId: string
    orgId: string
    orgName: string | null
    emailAddress: string
    kind: string
    expiresAt: string
    expiresInSeconds: number
  }>
  holdBuffer: {
    total: number
    byOrg: Array<{ orgId: string; orgName: string | null; count: number }>
  }
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

/** Build the cross-tenant read model used only by the superadmin sync console. */
export async function getSyncHealthReport(
  db: Db = prisma,
  readQueues: QueueReader = getSyncQueueHealth,
  now: Date = new Date(),
): Promise<SyncHealthReport> {
  const windowStart = new Date(now.getTime() - SYNC_HEALTH_WINDOW_HOURS * 60 * 60 * 1000)
  const [accounts, samples, holdGroups, queues] = await Promise.all([
    db.mailAccount.findMany({
      select: {
        id: true,
        orgId: true,
        emailAddress: true,
        provider: true,
        lastSyncedAt: true,
        gmailWatchExpiresAt: true,
        org: { select: { name: true } },
        pushSubscriptions: { select: { kind: true, expiresAt: true } },
      },
      orderBy: [{ orgId: 'asc' }, { emailAddress: 'asc' }],
    }),
    db.mailSyncHealthSample.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        mailAccountId: true,
        messagesScanned: true,
        messagesMatched: true,
        fullResync: true,
      },
    }),
    db.unmatchedActivity.groupBy({
      by: ['orgId'],
      _count: { _all: true },
    }),
    readQueues(),
  ])

  const holdOrgIds = holdGroups.map(({ orgId }) => orgId)
  const holdOrgs = holdOrgIds.length
    ? await db.org.findMany({ where: { id: { in: holdOrgIds } }, select: { id: true, name: true } })
    : []
  const holdOrgNames = new Map(holdOrgs.map((org) => [org.id, org.name]))

  const samplesByAccount = new Map<string, typeof samples>()
  for (const sample of samples) {
    const rows = samplesByAccount.get(sample.mailAccountId) ?? []
    rows.push(sample)
    samplesByAccount.set(sample.mailAccountId, rows)
  }

  const accountHealth = accounts.map((account) => {
    const rows = samplesByAccount.get(account.id) ?? []
    const messagesScanned = rows.reduce((total, row) => total + row.messagesScanned, 0)
    const messagesMatched = rows.reduce((total, row) => total + row.messagesMatched, 0)
    const fullResyncs = rows.filter((row) => row.fullResync).length
    return {
      id: account.id,
      orgId: account.orgId,
      orgName: account.org.name,
      emailAddress: account.emailAddress,
      provider: account.provider,
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      cursorAgeSeconds: account.lastSyncedAt
        ? Math.max(0, Math.floor((now.getTime() - account.lastSyncedAt.getTime()) / 1000))
        : null,
      syncRuns: rows.length,
      fullResyncs,
      fullResyncRate: rate(fullResyncs, rows.length),
      messagesScanned,
      messagesMatched,
      matchRate: rate(messagesMatched, messagesScanned),
    }
  })

  const subscriptions = accounts.flatMap((account) => {
    const expiries = [
      ...(account.gmailWatchExpiresAt
        ? [{ kind: 'google_mail', expiresAt: account.gmailWatchExpiresAt }]
        : []),
      ...account.pushSubscriptions,
    ]
    return expiries.map(({ kind, expiresAt }) => ({
      mailAccountId: account.id,
      orgId: account.orgId,
      orgName: account.org.name,
      emailAddress: account.emailAddress,
      kind,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
    }))
  }).sort((left, right) => left.expiresInSeconds - right.expiresInSeconds)

  const byOrg = holdGroups
    .map((group) => ({
      orgId: group.orgId,
      orgName: holdOrgNames.get(group.orgId) ?? null,
      count: group._count._all,
    }))
    .sort((left, right) => right.count - left.count)

  return {
    generatedAt: now.toISOString(),
    windowHours: SYNC_HEALTH_WINDOW_HOURS,
    queues,
    accounts: accountHealth,
    subscriptions,
    holdBuffer: { total: byOrg.reduce((total, row) => total + row.count, 0), byOrg },
  }
}
