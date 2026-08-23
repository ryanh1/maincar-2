import { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useArchiveDisposition, useCreateDisposition, useGetDispositions, useUpdateDisposition, useUpdateDispositionBar } from '@/hooks/dispositions'
import type { CreateDispositionInput, Disposition, DispositionCategory, DispositionColor } from '@/lib/dispositionTypes'
import { useAuth } from '@/providers/useAuth'

import { Settings_DispositionsBarEditor } from './Settings_DispositionsBarEditor'
import { Settings_DispositionsBarPreview } from './Settings_DispositionsBarPreview'

const COLOR_OPTIONS: Array<{ value: DispositionColor; label: string }> = [
  { value: 'option-1', label: 'Ocean' }, { value: 'option-2', label: 'Sky' }, { value: 'option-3', label: 'Indigo' }, { value: 'option-4', label: 'Violet' },
  { value: 'option-5', label: 'Rose' }, { value: 'option-6', label: 'Amber' }, { value: 'option-7', label: 'Teal' }, { value: 'option-8', label: 'Slate' },
]

type FormValues = CreateDispositionInput
const EMPTY_FORM: FormValues = { value: '', label: '', color: 'option-1', category: 'not_connected', icon: null }

function formFromDisposition(disposition: Disposition): FormValues {
  return { value: disposition.value, label: disposition.label, color: disposition.color, category: disposition.category, icon: disposition.icon, sortOrder: disposition.sortOrder }
}

export function Settings_DispositionsTab() {
  const { org } = useAuth()
  const dispositionsQuery = useGetDispositions(org?.id)
  const createDisposition = useCreateDisposition(org?.id ?? '')
  const updateDisposition = useUpdateDisposition(org?.id ?? '')
  const archiveDisposition = useArchiveDisposition(org?.id ?? '')
  const updateDispositionBar = useUpdateDispositionBar(org?.id ?? '')
  const [editing, setEditing] = useState<Disposition | 'new' | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Disposition | null>(null)
  const [form, setForm] = useState<FormValues>(EMPTY_FORM)
  const [pinnedIds, setPinnedIds] = useState<string[] | null>(null)
  const [barWarning, setBarWarning] = useState<string | null>(null)

  const dispositions = dispositionsQuery.data?.dispositions ?? []
  const isSaving = createDisposition.isPending || updateDisposition.isPending
  const currentPinnedIds = pinnedIds ?? dispositions.filter((disposition) => disposition.isPinned).map((disposition) => disposition.id)
  const byId = new Map(dispositions.map((disposition) => [disposition.id, disposition]))
  const pinned = currentPinnedIds.flatMap((id) => {
    const disposition = byId.get(id)
    return disposition ? [disposition] : []
  })
  const overflow = dispositions.filter((disposition) => !currentPinnedIds.includes(disposition.id))

  if (!org) return null

  function openNew() { setForm(EMPTY_FORM); setEditing('new') }
  function openEdit(disposition: Disposition) { setForm(formFromDisposition(disposition)); setEditing(disposition) }
  function closeEditor() { if (!isSaving) setEditing(null) }

  async function save(): Promise<void> {
    try {
      if (editing === 'new') await createDisposition.mutateAsync(form)
      else if (editing) await updateDisposition.mutateAsync({ id: editing.id, label: form.label, color: form.color, icon: form.icon || null, category: form.category, sortOrder: form.sortOrder })
      toast.success(editing === 'new' ? 'Disposition added.' : 'Disposition updated.')
      setEditing(null)
    } catch {
      toast.error('Could not save the disposition. Check the fields and try again.')
    }
  }

  async function archive(): Promise<void> {
    if (!archiveTarget) return
    try {
      await archiveDisposition.mutateAsync(archiveTarget.id)
      setPinnedIds((current) => current?.filter((id) => id !== archiveTarget.id) ?? null)
      toast.success('Disposition archived.')
      setArchiveTarget(null)
    } catch {
      toast.error('Could not archive the disposition. Try again.')
    }
  }

  async function publishBar(): Promise<void> {
    try {
      const response = await updateDispositionBar.mutateAsync({ pinnedIds: currentPinnedIds })
      setPinnedIds(response.dispositions.filter((disposition) => disposition.isPinned).map((disposition) => disposition.id))
      setBarWarning(null)
      toast.success('Disposition bar published.')
    } catch {
      setBarWarning('Could not publish the bar. Check your connection and try again.')
    }
  }

  return (
    <section className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Call dispositions</h2><p className="mt-1 text-xs text-text-muted">Choose which outcomes count as connected calls.</p></div>
        <Button type="button" size="sm" onClick={openNew}><Plus size={16} aria-hidden />Add disposition</Button>
      </div>

      {dispositionsQuery.isPending && <p className="text-sm text-text-muted">Loading dispositions.</p>}
      {dispositionsQuery.isError && <div className="flex items-center gap-3 border border-border p-3"><p className="text-sm text-destructive">Could not load dispositions.</p><Button type="button" size="sm" variant="secondary" onClick={() => void dispositionsQuery.refetch()}>Try again</Button></div>}
      {!dispositionsQuery.isPending && !dispositionsQuery.isError && dispositions.length === 0 && <div className="border border-border p-6 text-sm text-text-muted">Add a disposition before logging a call.</div>}
      {dispositions.length > 0 && <>
        <Settings_DispositionsBarPreview pinned={pinned} overflow={overflow} />
        <Settings_DispositionsBarEditor
          dispositions={dispositions}
          pinnedIds={currentPinnedIds}
          isPublishing={updateDispositionBar.isPending}
          warning={barWarning}
          onPinnedIdsChange={setPinnedIds}
          onWarningChange={setBarWarning}
          onPublish={() => void publishBar()}
        />
        <div className="overflow-x-auto border border-border"><table className="w-full"><caption className="sr-only">Call dispositions for {org.name}</caption><thead><tr className="border-b border-border bg-surface"><th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Label</th><th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Value</th><th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Category</th><th className="w-36 px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{dispositions.map((disposition) => <tr key={disposition.id} className="border-b border-border last:border-b-0"><td className="px-3 py-2 text-sm">{disposition.label}</td><td className="px-3 py-2 text-sm text-text-muted">{disposition.value}</td><td className="px-3 py-2 text-sm">{disposition.category === 'connected' ? 'Connected' : 'Not connected'}</td><td className="px-3 py-1 text-right"><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => openEdit(disposition)}>Edit</Button><Button type="button" size="sm" variant="ghost" onClick={() => setArchiveTarget(disposition)}>Archive</Button></div></td></tr>)}</tbody></table></div>
      </>}

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) closeEditor() }}><DialogContent showCloseButton={!isSaving} className="max-w-md"><DialogHeader><DialogTitle className="text-sm">{editing === 'new' ? 'Add disposition' : 'Edit disposition'}</DialogTitle><DialogDescription>{editing === 'new' ? 'The value stays stable while the label can change.' : 'Calls already logged keep this disposition.'}</DialogDescription></DialogHeader><form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save() }}><div className="flex flex-col gap-1"><Label htmlFor="disposition-label">Label</Label><Input id="disposition-label" className="h-8" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required /></div>{editing === 'new' && <div className="flex flex-col gap-1"><Label htmlFor="disposition-value">Value</Label><Input id="disposition-value" className="h-8" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} placeholder="follow_up" required /><p className="text-xs text-text-muted">Use lowercase letters, numbers, hyphens, or underscores.</p></div>}<div className="grid grid-cols-2 gap-3"><div className="flex flex-col gap-1"><Label>Category</Label><Select value={form.category} onValueChange={(category) => setForm({ ...form, category: category as DispositionCategory })}><SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="connected">Connected</SelectItem><SelectItem value="not_connected">Not connected</SelectItem></SelectContent></Select></div><div className="flex flex-col gap-1"><Label>Color</Label><Select value={form.color} onValueChange={(color) => setForm({ ...form, color: color as DispositionColor })}><SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent>{COLOR_OPTIONS.map((color) => <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>)}</SelectContent></Select></div></div><div className="flex flex-col gap-1"><Label htmlFor="disposition-icon">Icon</Label><Input id="disposition-icon" className="h-8" value={form.icon ?? ''} onChange={(event) => setForm({ ...form, icon: event.target.value || null })} placeholder="Optional Lucide icon name" /></div><DialogFooter><Button type="button" size="sm" variant="secondary" disabled={isSaving} onClick={closeEditor}>Cancel</Button><Button type="submit" size="sm" disabled={isSaving}>{isSaving ? 'Saving' : 'Save disposition'}</Button></DialogFooter></form></DialogContent></Dialog>

      <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => { if (!open && !archiveDisposition.isPending) setArchiveTarget(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-sm">Archive {archiveTarget?.label}?</AlertDialogTitle><AlertDialogDescription>This removes it from new call logs. Existing call history keeps the recorded outcome.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel size="sm" disabled={archiveDisposition.isPending}>Cancel</AlertDialogCancel><AlertDialogAction size="sm" variant="destructive" disabled={archiveDisposition.isPending} onClick={() => void archive()}>Archive disposition</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  )
}
