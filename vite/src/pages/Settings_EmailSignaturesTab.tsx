import { useMemo, useState, type KeyboardEvent } from 'react'
import { Trash2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeleteEmailSignature, useGetEmailSignatures, useSaveEmailSignature } from '@/hooks/email'
import type { EmailSignature, EmailSignaturePatch } from '@/hooks/email'
import { useUrlString } from '@/hooks/urlState'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_EmailSignatures_Form } from './Settings_EmailSignatures_Form'

type DefaultContext = 'new' | 'reply'

function isDefaultFor(signature: EmailSignature, context: DefaultContext): boolean {
  return context === 'new'
    ? (signature.isDefaultForNew ?? signature.isDefault)
    : (signature.isDefaultForReply ?? signature.isDefault)
}

function defaultPatch(context: DefaultContext, isDefault: boolean): EmailSignaturePatch {
  return context === 'new' ? { isDefaultForNew: isDefault } : { isDefaultForReply: isDefault }
}

function defaultLabel(context: DefaultContext): string {
  return context === 'new' ? 'Default signature for new messages' : 'Default signature for replies and forwards'
}

export function Settings_EmailSignaturesTab() {
  const { org } = useAuth()
  const orgId = org?.id ?? null
  const signaturesQuery = useGetEmailSignatures(orgId)
  const saveSignature = useSaveEmailSignature()
  const deleteSignature = useDeleteEmailSignature()
  const [selectedSignatureId, setSelectedSignatureId] = useUrlString('signature')
  const [confirmDelete, setConfirmDelete] = useState<EmailSignature | null>(null)

  const signatures = useMemo(() => signaturesQuery.data?.signatures ?? [], [signaturesQuery.data?.signatures])
  const selectedSignature = useMemo(
    () => selectedSignatureId === 'new'
      ? null
      : signatures.find((signature) => signature.id === selectedSignatureId)
      ?? signatures.find((signature) => isDefaultFor(signature, 'new'))
      ?? signatures[0]
      ?? null,
    [selectedSignatureId, signatures],
  )
  const isCreating = selectedSignatureId === 'new'

  if (!orgId) return null
  const activeOrgId = orgId

  function selectSignature(signatureId: string): void {
    setSelectedSignatureId(signatureId)
  }

  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const lastIndex = signatures.length - 1
    const nextIndex = event.key === 'ArrowDown' ? Math.min(index + 1, lastIndex)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? lastIndex
            : index
    if (nextIndex === index) return

    event.preventDefault()
    selectSignature(signatures[nextIndex].id)
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-signature-index="${nextIndex}"]`)
      ?.focus()
  }

  function changeDefault(context: DefaultContext, signatureId: string): void {
    const currentDefault = signatures.find((signature) => isDefaultFor(signature, context))
    const target = signatureId === 'none' ? currentDefault : signatures.find((signature) => signature.id === signatureId)
    if (!target) return

    saveSignature.mutate(
      { orgId: activeOrgId, signatureId: target.id, ...defaultPatch(context, signatureId !== 'none') },
      {
        onSuccess: () => toast.success(`${defaultLabel(context)} saved.`),
        onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not save the default signature. Try again.'),
      },
    )
  }

  function remove(signature: EmailSignature): void {
    deleteSignature.mutate(
      { orgId: activeOrgId, signatureId: signature.id },
      {
        onSuccess: () => {
          setConfirmDelete(null)
          if (signature.id === selectedSignature?.id) setSelectedSignatureId('')
          toast.success(`${signature.name} is gone.`)
        },
        onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not delete the signature. Try again.'),
      },
    )
  }

  return <section className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">Signatures</h2>
      <Button size="sm" onClick={() => selectSignature('new')}>New signature</Button>
    </div>

    {signaturesQuery.isPending && <div className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}
    {signaturesQuery.isError && <div className="flex items-center gap-3 rounded-md border border-border p-3"><p className="text-sm text-destructive">Could not load your signatures.</p><Button variant="secondary" size="sm" onClick={() => void signaturesQuery.refetch()}>Try again</Button></div>}

    {signaturesQuery.isSuccess && <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex min-h-64 flex-col rounded-md border border-border bg-surface p-2">
        <div role="listbox" aria-label="Signatures" className="flex flex-col gap-1 overflow-y-auto">
          {signatures.map((signature, index) => {
            const selected = signature.id === selectedSignature?.id && !isCreating
            const defaults = [
              isDefaultFor(signature, 'new') ? 'New messages' : null,
              isDefaultFor(signature, 'reply') ? 'Replies and forwards' : null,
            ].filter(Boolean).join(' · ')
            return <button
              key={signature.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => selectSignature(signature.id)}
              onKeyDown={(event) => moveSelection(event, index)}
              data-signature-index={index}
              className={cn(
                'flex flex-col gap-1 rounded-md px-2 py-2 text-left text-sm transition-colors',
                selected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-surface-2',
              )}
            >
              <span className="truncate">{signature.name}</span>
              {defaults && <span className="truncate text-xs font-normal text-text-muted">{defaults}</span>}
            </button>
          })}
          {signatures.length === 0 && <p className="p-2 text-sm text-text-muted">Create a signature to get started.</p>}
        </div>
      </div>

      <div className="min-w-0 rounded-md border border-border bg-bg p-3">
        {selectedSignature || isCreating ? <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{isCreating ? 'New signature' : 'Edit signature'}</h3>
            {selectedSignature && <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(selectedSignature)}><Trash2 size={16} aria-hidden />Delete {selectedSignature.name}</Button>}
          </div>
          <Settings_EmailSignatures_Form
            key={selectedSignature?.id ?? 'new'}
            orgId={activeOrgId}
            signature={selectedSignature}
            onSaved={(signature) => selectSignature(signature.id)}
            onCancel={() => setSelectedSignatureId(selectedSignature?.id ?? '')}
          />
        </div> : <p className="text-sm text-text-muted">Select a signature to edit it.</p>}

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">Defaults</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['new', 'reply'] as const).map((context) => {
              const currentDefault = signatures.find((signature) => isDefaultFor(signature, context))
              return <div key={context} className="flex flex-col gap-1">
                <Label htmlFor={`signature-default-${context}`}>{defaultLabel(context)}</Label>
                <Select value={currentDefault?.id ?? 'none'} onValueChange={(value) => changeDefault(context, value)} disabled={saveSignature.isPending || signatures.length === 0}>
                  <SelectTrigger id={`signature-default-${context}`} size="sm" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No signature</SelectItem>
                    {signatures.map((signature) => <SelectItem key={signature.id} value={signature.id}>{signature.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            })}
          </div>
        </div>
      </div>
    </div>}

    <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
          <AlertDialogDescription>Emails already written with this signature stay as they are.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={deleteSignature.isPending} onClick={(event) => { event.preventDefault(); if (confirmDelete) remove(confirmDelete) }}>{deleteSignature.isPending ? 'Deleting…' : 'Delete'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}
