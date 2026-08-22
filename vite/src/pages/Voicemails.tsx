import { Search, Voicemail } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetVoicemails } from '@/hooks/voicemails'
import { useSetUrlParams, useUrlInt, useUrlString } from '@/hooks/urlState'
import { formatDateTime } from '@/lib/datetime'
import { formatElapsed } from '@/lib/duration'
import type { VoicemailListItem } from '@/lib/voicemailTypes'
import { useAuth } from '@/providers/useAuth'

const PAGE_SIZE = 25

/** The shared inbox for received voicemails, pageable and searchable by caller. */
export function Voicemails() {
  const { user, org } = useAuth()
  const setUrlParams = useSetUrlParams()
  const [search] = useUrlString('q', '')
  const [page, setPage] = useUrlInt('page', 1)
  const query = useGetVoicemails(org?.id, {
    page,
    limit: PAGE_SIZE,
    q: search || undefined,
  })
  const data = query.data
  const rows = data?.voicemails ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader icon={Voicemail} title="Voicemails" count={total} />

      <div className="flex flex-col gap-3 pt-6">
        <div className="relative min-w-56 flex-1">
          <Search
            size={16}
            aria-hidden
            className="absolute top-1/2 left-2 -translate-y-1/2 text-text-muted"
          />
          <Input
            className="h-8 pl-8"
            placeholder="Search by caller number"
            aria-label="Search voicemails by caller number"
            value={search}
            onChange={(event) => setUrlParams({ q: event.target.value, page: null })}
          />
        </div>

        {query.isPending && <InboxLoading />}

        {query.isError && (
          <div role="alert" className="flex items-center gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-danger">Could not load voicemails.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {data && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full">
              <caption className="sr-only">Voicemails received by {org?.name}</caption>
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">From</th>
                  <th scope="col" className="w-28 px-3 py-2 text-left text-xs font-medium text-text-muted">Duration</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">Transcript</th>
                  <th scope="col" className="w-52 px-3 py-2 text-left text-xs font-medium text-text-muted">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((voicemail) => <VoicemailRow key={voicemail.id} voicemail={voicemail} timeZone={user?.timeZone} />)}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-base">No voicemails</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs tabular-nums text-text-muted">Page {page} of {lastPage}</p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InboxLoading() {
  return (
    <div aria-label="Loading voicemails" className="flex flex-col gap-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  )
}

function VoicemailRow({ voicemail, timeZone }: { voicemail: VoicemailListItem; timeZone: string | null | undefined }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 text-sm tabular-nums">
        <Link to={`/voicemails/${voicemail.id}`} className="text-primary underline-offset-4 hover:underline">
          {voicemail.fromE164}
        </Link>
      </td>
      <td className="px-3 py-2 text-sm tabular-nums">{voicemail.durationS === null ? '—' : formatElapsed(voicemail.durationS)}</td>
      <td className="max-w-md truncate px-3 py-2 text-sm">{transcriptLabel(voicemail)}</td>
      <td className="px-3 py-2 text-sm text-text-muted">{formatDateTime(voicemail.createdAt, timeZone)}</td>
    </tr>
  )
}

function transcriptLabel(voicemail: VoicemailListItem): string {
  if (voicemail.transcriptStatus === 'pending') return 'Transcribing…'
  if (voicemail.transcriptStatus === 'failed') return 'Transcript failed'
  return voicemail.transcript || 'No speech was transcribed.'
}
