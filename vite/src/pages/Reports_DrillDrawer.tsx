import { useState } from 'react'
import { X } from 'lucide-react'

import { RecordGrid } from '@/components/crm/RecordGrid'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGetObject, useGetObjects } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'
import type { AttributeDef } from '@/lib/crmTypes'
import type { DealDrillFilter, DealPivotDimension, ReportConfig, ReportDrillSelection } from '@/lib/reportTypes'
import { createViewConfig, type ViewConfig, type ViewFilterNode } from '@/components/crm/viewConfig'

const ATTRIBUTE_SLUG_BY_DIMENSION: Partial<Record<DealPivotDimension, string>> = {
  owner: 'ownerUserId',
  stage: 'stageId',
} as const

interface ReportsDrillDrawerProps {
  config: ReportConfig
  selection: ReportDrillSelection | null
  onClose: () => void
}

/**
 * The report's zero-copy drill surface: it turns the clicked pivot dimensions
 * into a temporary CRM view, so sorting, paging, and the record peek drawer all
 * stay on the established grid path.
 */
export function Reports_DrillDrawer({ config, selection, onClose }: ReportsDrillDrawerProps) {
  if (!selection) return null

  return (
    <ReportsDrillDrawerContent
      key={selection.filters.map((filter) => `${filter.field}:${filter.value}`).join('|')}
      config={config}
      selection={selection}
      onClose={onClose}
    />
  )
}

function ReportsDrillDrawerContent({ config, selection, onClose }: Omit<ReportsDrillDrawerProps, 'selection'> & { selection: ReportDrillSelection }) {
  const { org } = useAuth()
  const orgId = org?.id ?? null
  const objectsQuery = useGetObjects(orgId)
  const dealObject = objectsQuery.data?.objects.find((object) => object.slug === 'deal') ?? null
  const objectQuery = useGetObject(orgId, dealObject?.id ?? null)
  const attributes = objectQuery.data?.object.attributes ?? EMPTY_ATTRIBUTES
  const [filters, setFilters] = useState<DealDrillFilter[]>(selection.filters)
  const isLoading = objectsQuery.isPending || (!!dealObject && objectQuery.isPending)
  const isError = objectsQuery.isError || objectQuery.isError || !dealObject

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-5xl">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="text-base">Deals</SheetTitle>
          <SheetDescription className="text-sm">These records make up the selected pivot value.</SheetDescription>
          <div className="flex flex-wrap gap-2 pt-1" aria-label="Drill filters">
            {filters.map((filter) => (
              <Button
                key={`${filter.field}:${filter.value}`}
                type="button"
                size="sm"
                variant="secondary"
                className="rounded-full"
                aria-label={`Remove filter ${filterLabel(filter)}`}
                onClick={() => setFilters((current) => current.filter((item) => item !== filter))}
              >
                {filterLabel(filter)} <X className="size-3.5" aria-hidden="true" />
              </Button>
            ))}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 p-4">
          {isLoading && <div className="h-full animate-pulse rounded-md bg-surface" aria-label="Loading Deals" />}
          {isError && <p className="text-sm text-destructive">Could not open these Deals. Try again.</p>}
          {!isLoading && !isError && dealObject && objectQuery.data && attributes.length > 0 && (
            <DrillRecordGrid
              key={`${attributes.map((attribute) => attribute.id).join('|')}:${filters.map((filter) => `${filter.field}:${filter.value}`).join('|')}`}
              orgId={orgId!}
              object={objectQuery.data.object}
              attributes={attributes}
              reportConfig={config}
              filters={filters}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

const EMPTY_ATTRIBUTES: AttributeDef[] = []

function DrillRecordGrid({
  orgId,
  object,
  attributes,
  reportConfig,
  filters,
}: {
  orgId: string
  object: Parameters<typeof RecordGrid>[0]['object']
  attributes: AttributeDef[]
  reportConfig: ReportConfig
  filters: DealDrillFilter[]
}) {
  const [viewConfig, setViewConfig] = useState<ViewConfig>(() => createDrillViewConfig(attributes, reportConfig, filters))
  return <RecordGrid orgId={orgId} object={object} attributes={attributes} viewConfig={viewConfig} onViewConfigChange={setViewConfig} />
}

function filterLabel(filter: DealDrillFilter): string {
  return `${filter.field === 'owner' ? 'Owner' : 'Stage'}: ${filter.label}`
}

function createDrillViewConfig(attributes: AttributeDef[], reportConfig: ReportConfig, filters: DealDrillFilter[]) {
  const bySlug = new Map(attributes.map((attribute) => [attribute.slug, attribute]))
  const children = filters.flatMap((filter): ViewFilterNode[] => {
    const slug = ATTRIBUTE_SLUG_BY_DIMENSION[filter.field]
    const attribute = slug ? bySlug.get(slug) : undefined
    return attribute ? [{ type: 'condition', attributeId: attribute.id, operator: 'eq', value: filter.value }] : []
  })

  return {
    ...createViewConfig(attributes),
    ...(children.length > 0 ? { filterTree: { type: 'group' as const, op: 'and' as const, children } } : {}),
    ...(reportConfig.filters?.ownerTeam ? { teamScope: reportConfig.filters.ownerTeam } : {}),
  }
}
