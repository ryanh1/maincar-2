import { useState } from 'react'
import { ArrowLeft, ArrowRight, MoreHorizontal, PinOff, Plus, Tag, icons } from 'lucide-react'
import { toast } from 'sonner'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useGetDispositions } from '@/hooks/dispositions'
import { useCreateNextStepType, useGetDispositionNextStepRules, useGetNextStepTypes, useSaveDispositionNextStepRule, useUpdateNextStepBar, useUpdateNextStepType } from '@/hooks/nextSteps'
import { MAX_PINNED_DISPOSITIONS, pinDisposition, reorderPinned } from '@/lib/dispositionBar'
import type { DispositionColor } from '@/lib/dispositionTypes'
import type { CreateNextStepTypeInput, NextStepType } from '@/lib/nextStepTypes'
import { useAuth } from '@/providers/useAuth'

const COLOR_OPTIONS: Array<{ value: DispositionColor; label: string }> = [
  { value: 'option-1', label: 'Ocean' }, { value: 'option-2', label: 'Sky' }, { value: 'option-3', label: 'Indigo' }, { value: 'option-4', label: 'Violet' },
  { value: 'option-5', label: 'Rose' }, { value: 'option-6', label: 'Amber' }, { value: 'option-7', label: 'Teal' }, { value: 'option-8', label: 'Slate' },
]

const EMPTY_FORM: CreateNextStepTypeInput = {
  value: '', label: '', color: 'option-1', icon: null, isOverflow: false, requiresDateTime: false, createsTask: false,
}

function formFromType(type: NextStepType): CreateNextStepTypeInput {
  return {
    value: type.value, label: type.label, color: type.color, icon: type.icon, sortOrder: type.sortOrder,
    isOverflow: type.isOverflow, requiresDateTime: type.requiresDateTime, createsTask: type.createsTask,
  }
}

function typeStyle(color: DispositionColor) {
  return { backgroundColor: `color-mix(in srgb, var(--${color}) 16%, var(--background))`, borderColor: `var(--${color})`, color: `var(--${color})` }
}

function TypeLabel({ type }: { type: NextStepType }) {
  const Icon = type.icon ? icons[type.icon as keyof typeof icons] ?? Tag : Tag
  return <><Icon size={16} aria-hidden /><span>{type.label}</span></>
}

function NextStepPreview({ pinned, overflow }: { pinned: NextStepType[]; overflow: NextStepType[] }) {
  return (
    <div role="group" aria-label="Next-step row preview" className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto border border-border bg-surface p-3">
      {pinned.map((type) => <div key={type.id} className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-medium" style={typeStyle(type.color)}><TypeLabel type={type} /></div>)}
      {overflow.length > 0 && <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm text-text-muted"><MoreHorizontal size={16} aria-hidden />More ({overflow.length})</div>}
    </div>
  )
}

function BehaviorToggle({ id, label, description, checked, disabled, onCheckedChange }: { id: string; label: string; description: string; checked: boolean; disabled: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-b-0"><div><Label htmlFor={id}>{label}</Label><p className="mt-1 text-xs text-text-muted">{description}</p></div><Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></div>
}

export function Settings_NextStepsTab() {
  const { org, isAdmin } = useAuth()
  const typesQuery = useGetNextStepTypes(org?.id)
  const dispositionsQuery = useGetDispositions(org?.id)
  const rulesQuery = useGetDispositionNextStepRules(org?.id)
  const createType = useCreateNextStepType(org?.id ?? '')
  const updateType = useUpdateNextStepType(org?.id ?? '')
  const updateBar = useUpdateNextStepBar(org?.id ?? '')
  const saveRule = useSaveDispositionNextStepRule(org?.id ?? '')
  const [editing, setEditing] = useState<NextStepType | 'new' | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<NextStepType | null>(null)
  const [form, setForm] = useState<CreateNextStepTypeInput>(EMPTY_FORM)
  const [pinnedIds, setPinnedIds] = useState<string[] | null>(null)
  const [barWarning, setBarWarning] = useState<string | null>(null)
  const [ruleIds, setRuleIds] = useState<Record<string, string | null> | null>(null)

  if (!org) return null

  const types = (typesQuery.data?.types ?? []).filter((type) => !type.isArchived)
  const dispositions = (dispositionsQuery.data?.dispositions ?? []).filter((disposition) => !disposition.isArchived)
  const currentPinnedIds = pinnedIds ?? types.filter((type) => type.isPinned).map((type) => type.id)
  const typesById = new Map(types.map((type) => [type.id, type]))
  const pinned = currentPinnedIds.flatMap((id) => {
    const type = typesById.get(id)
    return type ? [type] : []
  })
  const overflow = types.filter((type) => !currentPinnedIds.includes(type.id))
  const savedRuleIds = Object.fromEntries((rulesQuery.data?.rules ?? []).filter((rule) => !rule.nextStepType.isArchived).map((rule) => [rule.dispositionId, rule.nextStepType.id]))
  const currentRuleIds = ruleIds ?? savedRuleIds
  const typeSaving = createType.isPending || updateType.isPending

  function changePinned(next: string[]) { setBarWarning(null); setPinnedIds(next) }
  function openNew() { setForm(EMPTY_FORM); setEditing('new') }
  function openEdit(type: NextStepType) { setForm(formFromType(type)); setEditing(type) }
  function closeEditor() { if (!typeSaving) setEditing(null) }

  async function saveType() {
    try {
      if (editing === 'new') await createType.mutateAsync(form)
      else if (editing) {
        const { value: _value, ...patch } = form
        await updateType.mutateAsync({ id: editing.id, ...patch })
      }
      toast.success(editing === 'new' ? 'Next step added.' : 'Next step updated.')
      setEditing(null)
    } catch {
      toast.error('Could not save the next step. Check the fields and try again.')
    }
  }

  async function archiveType() {
    if (!archiveTarget) return
    try {
      await updateType.mutateAsync({ id: archiveTarget.id, isArchived: true })
      setPinnedIds((current) => current?.filter((id) => id !== archiveTarget.id) ?? null)
      setRuleIds((current) => current ? Object.fromEntries(Object.entries(current).map(([id, typeId]) => [id, typeId === archiveTarget.id ? null : typeId])) : null)
      toast.success('Next step archived.')
      setArchiveTarget(null)
    } catch {
      toast.error('Could not archive the next step. Try again.')
    }
  }

  async function publishBar() {
    try {
      const response = await updateBar.mutateAsync({ pinnedIds: currentPinnedIds })
      setPinnedIds(response.types.filter((type) => type.isPinned).map((type) => type.id))
      setBarWarning(null)
      toast.success('Next-step row published.')
    } catch {
      setBarWarning('Could not publish the next-step row. Check your connection and try again.')
    }
  }

  async function saveSuggestion(dispositionId: string, nextStepTypeId: string | null) {
    try {
      await saveRule.mutateAsync({ dispositionId, nextStepTypeId })
      setRuleIds((current) => ({ ...(current ?? savedRuleIds), [dispositionId]: nextStepTypeId }))
      toast.success('Suggestion saved.')
    } catch {
      toast.error('Could not save the suggestion. Try again.')
    }
  }

  function pin(typeId: string) {
    const result = pinDisposition(currentPinnedIds, typeId)
    if (result.overflowed) {
      setBarWarning(`Only seven next steps fit in the row. ${typesById.get(typeId)?.label ?? 'This next step'} stays in More.`)
      return
    }
    changePinned(result.pinnedIds)
  }

  function move(typeId: string, direction: -1 | 1) {
    const index = currentPinnedIds.indexOf(typeId)
    const target = currentPinnedIds[index + direction]
    if (target) changePinned(reorderPinned(currentPinnedIds, typeId, target))
  }

  const loading = typesQuery.isPending || dispositionsQuery.isPending || rulesQuery.isPending
  const loadError = typesQuery.isError || dispositionsQuery.isError || rulesQuery.isError

  return (
    <section className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Next steps</h2><p className="mt-1 text-xs text-text-muted">Set the actions reps can add after a call.</p></div><Button type="button" size="sm" disabled={!isAdmin} onClick={openNew}><Plus size={16} aria-hidden />Add next step</Button></div>
      {!isAdmin && <p className="text-xs text-text-muted">Only an admin can change next steps.</p>}
      {loading && <p className="text-sm text-text-muted">Loading next steps.</p>}
      {loadError && <div className="flex items-center gap-3 border border-border p-3"><p className="text-sm text-destructive">Could not load next steps.</p><Button type="button" size="sm" variant="secondary" onClick={() => { void typesQuery.refetch(); void dispositionsQuery.refetch(); void rulesQuery.refetch() }}>Try again</Button></div>}
      {!loading && !loadError && <>
        <NextStepPreview pinned={pinned} overflow={overflow} />
        <section aria-labelledby="next-step-order-heading" className="flex flex-col gap-3 border border-border bg-bg p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="next-step-order-heading" className="text-sm font-semibold">Row order</h3><p className="text-xs text-text-muted">Move pinned next steps. Remaining next steps appear in More.</p></div><Button type="button" size="sm" disabled={!isAdmin || updateBar.isPending} onClick={() => void publishBar()}>{updateBar.isPending ? 'Publishing' : 'Publish next-step row'}</Button></div><div className="flex flex-col gap-2" aria-label="Pinned next steps">{pinned.map((type, index) => <div key={type.id} className="flex h-10 items-center gap-2 border border-border px-2 text-sm"><span className="min-w-0 flex-1 truncate">{type.label}</span><IconButton type="button" size="icon-sm" variant="ghost" tooltip={`Move ${type.label} left`} disabled={!isAdmin || index === 0} onClick={() => move(type.id, -1)}><ArrowLeft size={16} aria-hidden /></IconButton><IconButton type="button" size="icon-sm" variant="ghost" tooltip={`Move ${type.label} right`} disabled={!isAdmin || index === pinned.length - 1} onClick={() => move(type.id, 1)}><ArrowRight size={16} aria-hidden /></IconButton><IconButton type="button" size="icon-sm" variant="ghost" tooltip={`Remove ${type.label} from the row`} disabled={!isAdmin} onClick={() => changePinned(currentPinnedIds.filter((id) => id !== type.id))}><PinOff size={16} aria-hidden /></IconButton></div>)}</div>{barWarning && <p className="text-xs text-status-attention" role="status">{barWarning}</p>}<p className="text-xs text-text-muted">{pinned.length} of {MAX_PINNED_DISPOSITIONS} positions pinned.</p>{overflow.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Overflow next steps">{overflow.map((type) => <Button key={type.id} type="button" size="sm" variant="secondary" disabled={!isAdmin} onClick={() => pin(type.id)}>Pin {type.label}</Button>)}</div>}</section>
        <div className="overflow-x-auto border border-border"><table className="w-full"><caption className="sr-only">Next-step types for {org.name}</caption><thead><tr className="border-b border-border bg-surface"><th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Label</th><th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Value</th><th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Behavior</th><th className="w-36 px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{types.map((type) => <tr key={type.id} className="border-b border-border last:border-b-0"><td className="px-3 py-2 text-sm">{type.label}</td><td className="px-3 py-2 text-sm text-text-muted">{type.value}</td><td className="px-3 py-2 text-sm text-text-muted">{[type.requiresDateTime && 'Date and time', type.createsTask && 'Create task'].filter(Boolean).join(' · ') || 'None'}</td><td className="px-3 py-1 text-right"><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" disabled={!isAdmin} onClick={() => openEdit(type)}>Edit</Button><Button type="button" size="sm" variant="ghost" disabled={!isAdmin} onClick={() => setArchiveTarget(type)}>Archive</Button></div></td></tr>)}</tbody></table></div>
        <section aria-labelledby="suggestions-heading" className="border border-border"><div className="border-b border-border bg-surface px-3 py-2"><h3 id="suggestions-heading" className="text-sm font-semibold">Disposition suggestions</h3><p className="mt-1 text-xs text-text-muted">Choose one active suggested next step for each active disposition.</p></div><div className="divide-y divide-border">{dispositions.map((disposition) => <div key={disposition.id} className="grid grid-cols-1 items-center gap-2 p-3 sm:grid-cols-2"><Label htmlFor={`suggestion-${disposition.id}`}>{disposition.label}</Label><Select value={currentRuleIds[disposition.id] ?? 'none'} disabled={!isAdmin || saveRule.isPending} onValueChange={(value) => void saveSuggestion(disposition.id, value === 'none' ? null : value)}><SelectTrigger id={`suggestion-${disposition.id}`} aria-label={`Suggested next step for ${disposition.label}`} className="h-8 w-full"><SelectValue placeholder="No suggestion" /></SelectTrigger><SelectContent><SelectItem value="none">No suggestion</SelectItem>{types.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}</SelectContent></Select></div>)}</div></section>
      </>}
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) closeEditor() }}><DialogContent showCloseButton={!typeSaving} className="max-w-md"><DialogHeader><DialogTitle className="text-sm">{editing === 'new' ? 'Add next step' : 'Edit next step'}</DialogTitle><DialogDescription>{editing === 'new' ? 'The value stays stable while the label can change.' : 'Calls already logged keep the recorded next step.'}</DialogDescription></DialogHeader><form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void saveType() }}><div className="flex flex-col gap-1"><Label htmlFor="next-step-label">Label</Label><Input id="next-step-label" className="h-8" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required /></div>{editing === 'new' && <div className="flex flex-col gap-1"><Label htmlFor="next-step-value">Value</Label><Input id="next-step-value" className="h-8" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} placeholder="send_contract" required /><p className="text-xs text-text-muted">Use lowercase letters, numbers, hyphens, or underscores.</p></div>}<div className="grid grid-cols-2 gap-3"><div className="flex flex-col gap-1"><Label>Color</Label><Select value={form.color} onValueChange={(color) => setForm({ ...form, color: color as DispositionColor })}><SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent>{COLOR_OPTIONS.map((color) => <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>)}</SelectContent></Select></div><div className="flex flex-col gap-1"><Label htmlFor="next-step-icon">Icon</Label><Input id="next-step-icon" className="h-8" value={form.icon ?? ''} onChange={(event) => setForm({ ...form, icon: event.target.value || null })} placeholder="Optional Lucide icon" /></div></div><div className="border border-border px-3"><BehaviorToggle id="next-step-date-time" label="Require a date and time" description="The rep must schedule this next step." checked={form.requiresDateTime ?? false} disabled={typeSaving} onCheckedChange={(requiresDateTime) => setForm({ ...form, requiresDateTime })} /><BehaviorToggle id="next-step-create-task" label="Create a task" description="Save & Next creates a linked task for this step." checked={form.createsTask ?? false} disabled={typeSaving} onCheckedChange={(createsTask) => setForm({ ...form, createsTask })} /></div><DialogFooter><Button type="button" size="sm" variant="secondary" disabled={typeSaving} onClick={closeEditor}>Cancel</Button><Button type="submit" size="sm" disabled={typeSaving}>{typeSaving ? 'Saving' : 'Save next step'}</Button></DialogFooter></form></DialogContent></Dialog>
      <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => { if (!open && !updateType.isPending) setArchiveTarget(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-sm">Archive {archiveTarget?.label}?</AlertDialogTitle><AlertDialogDescription>This removes it from new call logs and clears suggestions that use it.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel size="sm" disabled={updateType.isPending}>Cancel</AlertDialogCancel><AlertDialogAction size="sm" variant="destructive" disabled={updateType.isPending} onClick={() => void archiveType()}>Archive next step</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  )
}
