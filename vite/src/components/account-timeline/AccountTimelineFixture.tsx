import { useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TooltipProvider } from '@/components/ui/tooltip'
import { useAccountTimelineRangePreference, useGetAccountTimeline, useGetAccountTimelineDetail } from '@/hooks/accountTimeline'
import type { AccountTimelineParams } from '@/lib/accountTimelineTypes'
import { AccountTimelineWorkspace } from './AccountTimelineWorkspace'
import { TimelineFilters, type TimelineFilterValue } from './TimelineFilters'
import { AccountTimelineDetailPanel } from './AccountTimelineDetailPanel'

const ROOT = { type: 'company' as const, id: 'company-fixture' }

/** Development-only shell for the real-browser shared-feed request-budget journey. */
export function AccountTimelineFixture() {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
    [],
  )
  return <QueryClientProvider client={client}><TooltipProvider><TimelineFixtureContent /></TooltipProvider></QueryClientProvider>
}

function TimelineFixtureContent() {
  const [filters, setFilters] = useState<TimelineFilterValue>({})
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null)
  const rangePreference = useAccountTimelineRangePreference('org-fixture', ROOT)
  const params: AccountTimelineParams = { ...filters, ...(rangePreference.range ?? {}) }
  const query = useGetAccountTimeline('org-fixture', ROOT, params)
  const detailQuery = useGetAccountTimelineDetail('org-fixture', ROOT, selectedEventId, params)
  const range = query.data?.pages[0]?.range ?? null
  const selectEvent = (eventId: string) => {
    setSelectedEventId(eventId)
    setHighlightedEventId(eventId)
  }

  return (
    <main className="min-h-dvh bg-bg p-6">
      <section className="flex w-full max-w-5xl flex-col gap-6" aria-labelledby="timeline-fixture-title">
        <div>
          <h1 id="timeline-fixture-title" className="text-base font-semibold">Account activity fixture</h1>
          <p className="mt-1 text-sm text-text-muted">Filters drive one shared event query for every timeline view.</p>
        </div>
        <TimelineFilters
          value={filters}
          onChange={setFilters}
          people={[{ id: 'person-fixture', label: 'Ada Lovelace' }]}
          deals={[{ id: 'deal-fixture', label: 'Enterprise renewal' }]}
        />
        <AccountTimelineWorkspace
          events={query.events}
          state={query.state}
          range={range}
          timeZone="America/New_York"
          selectedEventId={selectedEventId}
          highlightedEventId={highlightedEventId}
          onEventSelect={selectEvent}
          onHighlightedEventChange={setHighlightedEventId}
          onRangeChange={rangePreference.setRange}
          onResetRange={rangePreference.reset}
          onRetry={() => void query.refetch()}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
        />
        <AccountTimelineDetailPanel
          open={selectedEventId !== null}
          onOpenChange={(open) => { if (!open) setSelectedEventId(null) }}
          orgId="org-fixture"
          timeZone="America/New_York"
          detail={detailQuery.data?.detail ?? null}
          state={detailQuery.isError ? 'error' : detailQuery.data ? 'ready' : 'loading'}
          navigation={detailQuery.data?.navigation ?? null}
          onNavigate={selectEvent}
          onRetry={() => void detailQuery.refetch()}
        />
      </section>
    </main>
  )
}
