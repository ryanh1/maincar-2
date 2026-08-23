import { useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/PageHeader'
import { RecordGrid } from '@/components/crm/RecordGrid'
import { NewListDialog } from '@/components/crm/NewListDialog'
import { createViewConfig, sameViewConfig, useViewConfig } from '@/components/crm/viewConfig'
import { Button } from '@/components/ui/button'
import { useGetObject, useGetObjects } from '@/hooks/crm'
import {
  useDeleteView,
  useDuplicateView,
  useGetViews,
  useReorderViews,
  useRestoreView,
  useSaveView,
  useSetDefaultView,
  useUpdateView,
} from '@/hooks/savedViews'
import { useAuth } from '@/providers/useAuth'

import { Records_SavedViewControls } from './Records_SavedViewControls'

/**
 * One object's rows, read-only, on the Glide canvas grid (MAI-164, plan T0.2;
 * spec CHUNK-1 §B, Slice S0). Reachable at /records/:slug — the left-rail nav
 * that links here is T1.1, a separate slice.
 */
export function Records() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { org } = useAuth()
  const orgId = org?.id ?? null

  const objectsQuery = useGetObjects(orgId)
  const object = objectsQuery.data?.objects.find((o) => o.slug === slug) ?? null
  const isUnavailable = object !== null && (object.isHidden || object.isArchived || !object.capabilities.list)

  const objectQuery = useGetObject(orgId, isUnavailable ? null : object?.id ?? null)
  const detail = objectQuery.data?.object ?? null
  const viewsQuery = useGetViews(orgId, detail?.id ?? null)
  const views = viewsQuery.data?.views ?? []
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [layoutOverride, setLayoutOverride] = useState<'grid' | 'kanban' | null>(null)
  const defaultView = views.find((view) => view.isDefault) ?? null
  const selectedView = selectedViewId ? views.find((view) => view.id === selectedViewId) ?? null : defaultView
  const fallbackConfig = useMemo(() => createViewConfig(detail?.attributes ?? []), [detail?.attributes])
  const baselineConfig = selectedView?.config ?? fallbackConfig
  const layout = layoutOverride ?? (selectedView?.layout === 'kanban' ? 'kanban' : 'grid')
  const [viewConfig, setViewConfig, resetViewConfig] = useViewConfig(detail?.attributes ?? [], baselineConfig)
  const hasUnsavedChanges = !sameViewConfig(viewConfig, baselineConfig)
  const saveView = useSaveView()
  const updateView = useUpdateView()
  const duplicateView = useDuplicateView()
  const deleteView = useDeleteView()
  const restoreView = useRestoreView()
  const reorderViews = useReorderViews()
  const setDefaultView = useSetDefaultView()
  const isSaving = saveView.isPending || updateView.isPending || duplicateView.isPending || deleteView.isPending || restoreView.isPending || reorderViews.isPending || setDefaultView.isPending
  const [createRequestToken, setCreateRequestToken] = useState(0)
  const [newListOpen, setNewListOpen] = useState(false)

  const isPending = objectsQuery.isPending || (!isUnavailable && object !== null && (objectQuery.isPending || viewsQuery.isPending))
  const isError = objectsQuery.isError || (!isUnavailable && (objectQuery.isError || viewsQuery.isError))

  function retry() {
    void objectsQuery.refetch()
    if (object) void objectQuery.refetch()
    if (detail) void viewsQuery.refetch()
  }

  function selectView(viewId: string | null) {
    setSelectedViewId(viewId)
    setLayoutOverride(null)
    resetViewConfig()
  }

  async function saveChanges() {
    if (!orgId || !detail) return
    try {
      if (selectedView) {
        await updateView.mutateAsync({ orgId, viewId: selectedView.id, config: viewConfig, layout })
      } else {
        const result = await saveView.mutateAsync({ orgId, objectId: detail.id, name: 'Default view', config: viewConfig, layout })
        setSelectedViewId(result.view.id)
        setLayoutOverride(null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save changes. Try again.')
    }
  }

  async function changeLayout(nextLayout: 'grid' | 'kanban') {
    if (!orgId || !detail || nextLayout === layout) return
    setLayoutOverride(nextLayout)
    try {
      if (selectedView) {
        await updateView.mutateAsync({ orgId, viewId: selectedView.id, config: viewConfig, layout: nextLayout })
      } else {
        const result = await saveView.mutateAsync({ orgId, objectId: detail.id, name: 'Default view', config: viewConfig, layout: nextLayout })
        setSelectedViewId(result.view.id)
        setLayoutOverride(null)
      }
    } catch (error) {
      setLayoutOverride(null)
      toast.error(error instanceof Error ? error.message : 'Could not save the layout. Try again.')
    }
  }

  async function manageView(action: () => Promise<void>) {
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update this view. Try again.')
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col">
      <PageHeader
        icon={Table2}
        title={detail?.namePlural ?? object?.namePlural ?? slug ?? 'Records'}
        action={detail ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setNewListOpen(true)}>New list</Button>
            {detail.isGridCreateSupported && <Button size="sm" onClick={() => setCreateRequestToken((current) => current + 1)}>New</Button>}
          </div>
        ) : undefined}
      />

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
            This object is unavailable. Choose another object.
          </div>
        )}

        {!isPending && !isError && !isUnavailable && orgId && detail && (
          <RecordGrid
            orgId={orgId}
            object={detail}
            attributes={detail.attributes}
            viewId={selectedView?.id ?? null}
            initialRecordId={searchParams.get('recordId')}
            viewConfig={viewConfig}
            onViewConfigChange={setViewConfig}
            toolbarLeading={
              <Records_SavedViewControls
                views={views}
                selectedViewId={selectedView?.id ?? null}
                hasUnsavedChanges={hasUnsavedChanges}
                isSaving={isSaving}
                onSelectView={selectView}
                onSave={() => void saveChanges()}
                onReset={resetViewConfig}
                onRename={(name) => manageView(async () => {
                  if (!selectedView) return
                  await updateView.mutateAsync({ orgId, viewId: selectedView.id, name })
                })}
                onDuplicate={() => manageView(async () => {
                  if (!selectedView) return
                  const duplicate = await duplicateView.mutateAsync({ orgId, viewId: selectedView.id })
                  setSelectedViewId(duplicate.view.id)
                })}
                onDelete={() => manageView(async () => {
                  if (!selectedView) return
                  await deleteView.mutateAsync({ orgId, viewId: selectedView.id })
                  setSelectedViewId(null)
                  resetViewConfig()
                })}
                onRestore={() => manageView(async () => {
                  if (!selectedView) return
                  await restoreView.mutateAsync({ orgId, viewId: selectedView.id })
                  setSelectedViewId(selectedView.id)
                })}
                onVisibilityChange={(isShared) => manageView(async () => {
                  if (!selectedView) return
                  await updateView.mutateAsync({ orgId, viewId: selectedView.id, isShared })
                })}
                onSetDefault={() => manageView(async () => {
                  if (!selectedView) return
                  await setDefaultView.mutateAsync({ orgId, viewId: selectedView.id })
                })}
                onReorder={(viewIds) => manageView(async () => {
                  await reorderViews.mutateAsync({ orgId, objectId: detail.id, viewIds })
                })}
              />
            }
            createRequestToken={createRequestToken}
            layout={layout}
            onLayoutChange={(nextLayout) => void changeLayout(nextLayout)}
          />
        )}
      </div>
      {newListOpen && orgId && detail && <NewListDialog open onOpenChange={setNewListOpen} orgId={orgId} object={detail} onCreated={(list) => navigate(`/lists/${list.id}`)} />}
    </div>
  )
}
