import { Table2 } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { PageHeader } from '@/components/PageHeader'
import { RecordGrid } from '@/components/crm/RecordGrid'
import { useViewConfig } from '@/components/crm/viewConfig'
import { Button } from '@/components/ui/button'
import { useGetObject, useGetObjects } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'

/**
 * One object's rows, read-only, on the Glide canvas grid (MAI-164, plan T0.2;
 * spec CHUNK-1 §B, Slice S0). Reachable at /records/:slug — the left-rail nav
 * that links here is T1.1, a separate slice.
 */
export function Records() {
  const { slug } = useParams<{ slug: string }>()
  const { org } = useAuth()
  const orgId = org?.id ?? null

  const objectsQuery = useGetObjects(orgId)
  const object = objectsQuery.data?.objects.find((o) => o.slug === slug) ?? null
  const isUnavailable = object !== null && (object.isHidden || object.isArchived || !object.isListSupported)

  const objectQuery = useGetObject(orgId, isUnavailable ? null : object?.id ?? null)
  const detail = objectQuery.data?.object ?? null
  const [viewConfig, setViewConfig] = useViewConfig(detail?.attributes ?? [])

  const isPending = objectsQuery.isPending || (!isUnavailable && object !== null && objectQuery.isPending)
  const isError = objectsQuery.isError || (!isUnavailable && objectQuery.isError)

  function retry() {
    void objectsQuery.refetch()
    if (object) void objectQuery.refetch()
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col">
      <PageHeader icon={Table2} title={detail?.namePlural ?? object?.namePlural ?? slug ?? 'Records'} />

      <div className="min-h-0 flex-1 pt-4">
        {isPending && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {!isPending && isError && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">Could not load this object.</p>
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        )}

        {!isPending && !isError && !object && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No object named &quot;{slug}&quot;.
          </div>
        )}

        {!isPending && !isError && isUnavailable && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            This object is not available.
          </div>
        )}

        {!isPending && !isError && !isUnavailable && orgId && detail && (
          <RecordGrid
            orgId={orgId}
            object={detail}
            attributes={detail.attributes}
            viewConfig={viewConfig}
            onViewConfigChange={setViewConfig}
          />
        )}
      </div>
    </div>
  )
}
