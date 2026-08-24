import { useMemo, useState } from 'react'

import { formatCellValue } from '@/components/crm/recordCellValue'
import {
  useAccountTimelineFilterPreference,
  useAccountTimelineRangePreference,
  useGetAccountTimeline,
  useGetAccountTimelineDetail,
} from '@/hooks/accountTimeline'
import { useGetRelatedRecords } from '@/hooks/crm'
import type { AccountTimelineEvent, AccountTimelineParams, AccountTimelineRoot } from '@/lib/accountTimelineTypes'
import type { RelatedRecordGroup } from '@/lib/crmTypes'
import { AccountTimelineDetailPanel } from './AccountTimelineDetailPanel'
import { AccountTimelineWorkspace } from './AccountTimelineWorkspace'
import { TimelineFilters, type TimelineFilterOption, type TimelineFilterValue } from './TimelineFilters'

function timelineOptions(
  events: AccountTimelineEvent[],
  id: 'personId' | 'dealId',
  label: 'personName' | 'dealName',
): TimelineFilterOption[] {
  const options = new Map<string, string>()
  for (const event of events) {
    const optionId = event[id]
    const optionLabel = event.display[label]
    if (optionId && optionLabel) options.set(optionId, optionLabel)
  }
  return [...options].map(([optionId, optionLabel]) => ({ id: optionId, label: optionLabel }))
}

function relatedOptions(
  groups: RelatedRecordGroup[],
  objectSlug: 'person' | 'deal',
  timeZone: string | null | undefined,
): TimelineFilterOption[] {
  const options = new Map<string, string>()
  for (const group of groups.filter((candidate) => candidate.object.slug === objectSlug)) {
    const identity = group.object.attributes.find((attribute) => attribute.isIdentity) ?? group.object.attributes[0]
    if (!identity) continue
    for (const record of group.records) {
      const label = formatCellValue(record[identity.slug], identity.type, timeZone)
      if (label) options.set(record.id, label)
    }
  }
  return [...options].map(([id, label]) => ({ id, label }))
}

function mergeOptions(primary: TimelineFilterOption[], fallback: TimelineFilterOption[]): TimelineFilterOption[] {
  return [...new Map([...primary, ...fallback].map((option) => [option.id, option])).values()]
}

/** The shared Journey 6.9 timeline mounted for one real Company or Deal record. */
export function AccountTimelineRecordTab({
  orgId,
  objectId,
  root,
  timeZone,
}: {
  orgId: string
  objectId: string
  root: AccountTimelineRoot
  timeZone: string | null | undefined
}) {
  const filterPreference = useAccountTimelineFilterPreference(orgId, root)
  const rangePreference = useAccountTimelineRangePreference(orgId, root)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null)
  const params: AccountTimelineParams = {
    ...filterPreference.filters,
    ...(rangePreference.range ?? {}),
  }
  const relatedQuery = useGetRelatedRecords(orgId, root.type === 'company' ? objectId : null, root.id)
  const query = useGetAccountTimeline(orgId, root, params)
  const detailQuery = useGetAccountTimelineDetail(orgId, root, selectedEventId, params)
  const range = query.data?.pages[0]?.range ?? null
  const people = useMemo(
    () => mergeOptions(relatedOptions(relatedQuery.data?.related ?? [], 'person', timeZone), timelineOptions(query.events, 'personId', 'personName')),
    [query.events, relatedQuery.data?.related, timeZone],
  )
  const deals = useMemo(
    () => mergeOptions(relatedOptions(relatedQuery.data?.related ?? [], 'deal', timeZone), timelineOptions(query.events, 'dealId', 'dealName')),
    [query.events, relatedQuery.data?.related, timeZone],
  )

  function clearSelection() {
    setSelectedEventId(null)
    setHighlightedEventId(null)
  }

  function selectEvent(eventId: string) {
    setSelectedEventId(eventId)
    setHighlightedEventId(eventId)
  }

  function changeFilters(filters: TimelineFilterValue) {
    clearSelection()
    filterPreference.setFilters(filters)
  }

  function changeRange(nextRange: { from: string; to: string }) {
    clearSelection()
    rangePreference.setRange(nextRange)
  }

  function resetRange() {
    clearSelection()
    rangePreference.reset()
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6" aria-labelledby="record-timeline-heading">
      <h2 id="record-timeline-heading" className="text-sm font-semibold">Timeline</h2>
      <TimelineFilters
        value={filterPreference.filters}
        onChange={changeFilters}
        people={people}
        deals={deals}
        rootType={root.type}
      />
      <AccountTimelineWorkspace
        events={query.events}
        state={query.state}
        range={range}
        timeZone={timeZone}
        selectedEventId={selectedEventId}
        highlightedEventId={highlightedEventId}
        onEventSelect={selectEvent}
        onHighlightedEventChange={setHighlightedEventId}
        onRangeChange={changeRange}
        onResetRange={resetRange}
        onRetry={() => void query.refetch()}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => void query.fetchNextPage()}
      />
      <AccountTimelineDetailPanel
        open={selectedEventId !== null}
        onOpenChange={(open) => { if (!open) setSelectedEventId(null) }}
        orgId={orgId}
        detail={detailQuery.data?.detail ?? null}
        navigation={detailQuery.data?.navigation ?? null}
        onNavigate={selectEvent}
      />
    </section>
  )
}
