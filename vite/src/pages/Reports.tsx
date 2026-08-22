import { useState, type FormEvent } from 'react'
import { BarChart3 } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useCreateReport,
  useDeleteReport,
  useGetReport,
  useGetReports,
  useRenameReport,
  useRunReport,
  useUpdateReportConfig,
} from '@/hooks/reports'
import { useUrlInt } from '@/hooks/urlState'
import { formatDateTime } from '@/lib/datetime'
import type { OwnerTeamScope, ReportConfig, SavedReport } from '@/lib/reportTypes'
import { isRunnablePivot } from '@/lib/reportConfig'
import { PageHeader } from '@/components/PageHeader'
import { useAuth } from '@/providers/useAuth'
import { Reports_OwnerTeamScope } from './Reports_OwnerTeamScope'
import { ReportsPivotBuilder } from './Reports_PivotBuilder'

const DEFAULT_REPORT_CONFIG: ReportConfig = {
  baseObject: 'deal',
  rows: [],
  columns: [],
  values: [],
  timeZone: { mode: 'viewer' },
}
const PAGE_SIZE = 50

function kindLabel(kind: string): string {
  return kind === 'pivot' ? 'Pivot' : 'Report'
}

// MAI-145 briefly stored the one-dimension config before Columns existed.
// Keep those reports runnable while new saves always carry the full shape.
function normalizeReportConfig(config: ReportConfig): ReportConfig {
  return { ...config, columns: config.columns ?? [] }
}

/**
 * The first Reports home: a rep can open their saved reports, start the known
 * stage-and-amount report, name it, reopen it, rename it, or move it to Trash.
 * Templates, sharing, and editing the config have their own P1 tickets.
 */
export function Reports() {
  const { org, user } = useAuth()
  const orgId = org?.id ?? null
  const [page, setPage] = useUrlInt('page', 1)
  const reportsQuery = useGetReports(orgId, { page, limit: PAGE_SIZE })
  const createReport = useCreateReport()
  const renameReport = useRenameReport()
  const deleteReport = useDeleteReport()
  const updateReportConfig = useUpdateReportConfig()

  const [openReportId, setOpenReportId] = useState<string | null>(null)
  const [isNewReport, setIsNewReport] = useState(false)
  const [newConfig, setNewConfig] = useState<ReportConfig>(DEFAULT_REPORT_CONFIG)
  const [draftConfig, setDraftConfig] = useState<ReportConfig | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SavedReport | null>(null)
  const [name, setName] = useState('')

  const reportQuery = useGetReport(orgId, openReportId)
  const openedReport = reportQuery.data?.report
  const activeConfig = openedReport ? normalizeReportConfig(draftConfig ?? openedReport.config) : (isNewReport ? newConfig : null)
  const activeReportId = openReportId ?? (isNewReport ? 'new-report' : null)
  const runQuery = useRunReport(orgId, activeReportId, activeConfig && isRunnablePivot(activeConfig) ? activeConfig : null)

  function startNewReport(): void {
    setOpenReportId(null)
    setDraftConfig(null)
    setNewConfig(DEFAULT_REPORT_CONFIG)
    setIsNewReport(true)
  }

  function openReport(reportId: string): void {
    setIsNewReport(false)
    setDraftConfig(null)
    setOpenReportId(reportId)
  }

  function closeActiveReport(): void {
    setOpenReportId(null)
    setIsNewReport(false)
    setDraftConfig(null)
  }

  function setOwnerTeamScope(scope: OwnerTeamScope | undefined): void {
    if (!activeConfig) return
    const { filters: _filters, ...withoutFilters } = activeConfig
    const nextConfig = scope ? { ...withoutFilters, filters: { ownerTeam: scope } } : withoutFilters
    if (isNewReport) setNewConfig(nextConfig)
    else setDraftConfig(nextConfig)
  }

  function saveChanges(): void {
    if (!orgId || !openedReport || !draftConfig) return
    updateReportConfig.mutate(
      { orgId, reportId: openedReport.id, config: draftConfig },
      {
        onSuccess: () => {
          setDraftConfig(null)
          toast.success('Report saved.')
        },
        onError: () => toast.error('Could not save the report. Try again.'),
      },
    )
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name the report to save it.')
      return
    }
    if (!orgId || !activeConfig || !isRunnablePivot(activeConfig)) {
      toast.error('Add a group and Amount before saving.')
      return
    }

    createReport.mutate(
      { orgId, name: trimmed, config: activeConfig },
      {
        onSuccess: ({ report }) => {
          setSaveOpen(false)
          setName('')
          setIsNewReport(false)
          setOpenReportId(report.id)
          toast.success('Report saved.')
        },
        onError: () => toast.error('Could not save the report. Try again.'),
      },
    )
  }

  function changeConfig(config: ReportConfig): void {
    if (openedReport) setDraftConfig(config)
    else setNewConfig(config)
  }

  function beginRename(): void {
    if (!openedReport) return
    setName(openedReport.name)
    setRenameOpen(true)
  }

  function rename(event: FormEvent): void {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name the report to save it.')
      return
    }
    if (!orgId || !openedReport) return

    renameReport.mutate(
      { orgId, reportId: openedReport.id, name: trimmed },
      {
        onSuccess: () => {
          setRenameOpen(false)
          setName('')
          toast.success('Report renamed.')
        },
        onError: () => toast.error('Could not rename the report. Try again.'),
      },
    )
  }

  function removeReport(): void {
    if (!orgId || !deleteTarget) return
    deleteReport.mutate(
      { orgId, reportId: deleteTarget.id },
      {
        onSuccess: () => {
          if (openReportId === deleteTarget.id) closeActiveReport()
          if (reportsQuery.data?.reports.length === 1 && page > 1) setPage(page - 1)
          setDeleteTarget(null)
          toast.success('Report moved to Trash.')
        },
        onError: () => toast.error('Could not move the report to Trash. Try again.'),
      },
    )
  }

  const total = reportsQuery.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        icon={BarChart3}
        title="Reports"
        count={reportsQuery.data?.total}
        action={
          <Button size="sm" onClick={startNewReport}>
            New report
          </Button>
        }
      />

      {activeConfig ? (
        <section className="flex flex-col gap-4" aria-labelledby="active-report-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 id="active-report-title" className="text-sm font-semibold">
                {openedReport?.name ?? 'New report'}
              </h2>
              {isNewReport && <span className="rounded-full bg-surface px-2 py-1 text-xs text-text-muted">Unsaved</span>}
            </div>
            <div className="flex items-center gap-2">
              {isNewReport ? (
                <Button size="sm" disabled={!isRunnablePivot(activeConfig)} onClick={() => setSaveOpen(true)}>
                  Save report
                </Button>
              ) : (
                <>
                  {draftConfig && (
                    <Button size="sm" onClick={saveChanges} disabled={updateReportConfig.isPending}>
                      {updateReportConfig.isPending ? 'Saving…' : 'Save changes'}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={beginRename}>
                    Rename report
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => openedReport && setDeleteTarget(openedReport)}>
                    Delete report
                  </Button>
                </>
              )}
              <Button size="sm" variant="secondary" onClick={closeActiveReport}>
                Back to reports
              </Button>
            </div>
          </div>

          <Reports_OwnerTeamScope
            orgId={orgId}
            value={activeConfig.filters?.ownerTeam}
            onChange={setOwnerTeamScope}
          />

          {reportQuery.isPending && openReportId && <Skeleton className="h-32 w-full" />}
          {reportQuery.isError && <p className="text-sm text-destructive">Could not open this report. Try again.</p>}
          {runQuery.isError && <p className="text-sm text-destructive">Could not run this report. Try again.</p>}
          <ReportsPivotBuilder config={activeConfig} onChange={changeConfig} result={runQuery.data?.report} />
        </section>
      ) : (
        <section className="flex flex-col gap-3" aria-labelledby="my-reports-title">
          <h2 id="my-reports-title" className="text-sm font-semibold">My reports</h2>
          {reportsQuery.isPending && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {reportsQuery.isError && (
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <p className="text-sm text-destructive">Could not load your reports.</p>
              <Button size="sm" variant="secondary" onClick={() => void reportsQuery.refetch()}>Try again</Button>
            </div>
          )}
          {reportsQuery.data && reportsQuery.data.reports.length === 0 && (
            <div className="rounded-md border border-border p-6 text-sm text-text-muted">
              Create a report to track your pipeline.
            </div>
          )}
          {reportsQuery.data && reportsQuery.data.reports.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full">
                <caption className="sr-only">Your saved reports</caption>
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">Name</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">Type</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">Last edited</th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reportsQuery.data.reports.map((report) => (
                    <tr key={report.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-sm">{report.name}</td>
                      <td className="px-3 py-2 text-sm text-text-muted">{kindLabel(report.kind)}</td>
                      <td className="px-3 py-2 text-sm text-text-muted">{formatDateTime(report.updatedAt, user?.timeZone)}</td>
                      <td className="px-3 py-1 text-right">
                        <Button size="sm" variant="secondary" onClick={() => openReport(report.id)}>
                          Open {report.name}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs tabular-nums text-text-muted">Page {page} of {lastPage}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </section>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save report</DialogTitle>
            <DialogDescription>Name this report so you can find it again.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={save}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-name">Name <RequiredAsterisk /></Label>
              <Input id="report-name" required maxLength={200} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" size="sm" variant="secondary" onClick={() => setSaveOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createReport.isPending}>{createReport.isPending ? 'Saving…' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename report</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={rename}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="renamed-report-name">Name <RequiredAsterisk /></Label>
              <Input id="renamed-report-name" required maxLength={200} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" size="sm" variant="secondary" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={renameReport.isPending}>{renameReport.isPending ? 'Renaming…' : 'Rename'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This report stays in Trash for 30 days.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              disabled={deleteReport.isPending}
              onClick={(event) => {
                event.preventDefault()
                removeReport()
              }}
            >
              {deleteReport.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
