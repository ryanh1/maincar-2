import { useState } from 'react'
import { MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeleteEmailSignature, useGetEmailSignatures, useSaveEmailSignature } from '@/hooks/email'
import type { EmailSignature } from '@/hooks/email'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'
import { Settings_EmailSignatures_Form } from './Settings_EmailSignatures_Form'

export function Settings_EmailSignaturesTab() {
  const { org } = useAuth()
  const orgId = org?.id ?? null
  const signaturesQuery = useGetEmailSignatures(orgId)
  const saveSignature = useSaveEmailSignature()
  const deleteSignature = useDeleteEmailSignature()
  const [editing, setEditing] = useState<{ signature: EmailSignature | null } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<EmailSignature | null>(null)
  if (!orgId) return null
  const activeOrgId = orgId
  const signatures = signaturesQuery.data?.signatures ?? []

  function makeDefault(signature: EmailSignature) {
    saveSignature.mutate({ orgId: activeOrgId, signatureId: signature.id, isDefault: true }, {
      onSuccess: () => toast.success(`${signature.name} is now your default signature.`),
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not set the default signature. Try again.'),
    })
  }
  function remove(signature: EmailSignature) {
    deleteSignature.mutate({ orgId: activeOrgId, signatureId: signature.id }, {
      onSuccess: () => { setConfirmDelete(null); toast.success(`${signature.name} is gone.`) },
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not delete the signature. Try again.'),
    })
  }
  if (editing) return <Settings_EmailSignatures_Form key={editing.signature?.id ?? 'new'} orgId={activeOrgId} signature={editing.signature} onDone={() => setEditing(null)} />

  return <section className="flex flex-col gap-6">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Signatures</h2>
      {signatures.length > 0 && <Button size="sm" onClick={() => setEditing({ signature: null })}>New signature</Button>}
    </div>
    {signaturesQuery.isPending && <div className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}
    {signaturesQuery.isError && <div className="flex items-center gap-3 rounded-md border border-border p-3"><p className="text-sm text-destructive">Could not load your signatures.</p><Button variant="secondary" size="sm" onClick={() => void signaturesQuery.refetch()}>Try again</Button></div>}
    {signaturesQuery.isSuccess && signatures.length === 0 && <div className="flex flex-col items-center gap-3 rounded-md border border-border py-12 text-center"><p className="text-base font-semibold">Add the sign-off you send most often.</p><Button size="sm" onClick={() => setEditing({ signature: null })}>New signature</Button></div>}
    {signaturesQuery.isSuccess && signatures.length > 0 && <div className="overflow-x-auto rounded-md border border-border"><table className="w-full"><caption className="sr-only">Your email signatures</caption><thead><tr className="border-b border-border bg-surface"><th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">Name</th><th scope="col" className="w-32 px-3 py-2 text-left text-xs font-medium text-text-muted">Default</th><th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{signatures.map((signature) => <tr key={signature.id} className="border-b border-border last:border-0"><td className="px-3 py-1 text-sm font-medium">{signature.name}</td><td className="px-3 py-1 text-sm text-text-muted">{signature.isDefault ? 'Default' : ''}</td><td className="px-2 py-1 text-right"><DropdownMenu><DropdownMenuTrigger asChild><IconButton tooltip={`Show actions for ${signature.name}`}><MoreHorizontal size={16} aria-hidden /></IconButton></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setEditing({ signature })}><Pencil size={16} aria-hidden />Edit</DropdownMenuItem>{!signature.isDefault && <DropdownMenuItem onSelect={() => makeDefault(signature)}><Star size={16} aria-hidden />Make default</DropdownMenuItem>}<DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(signature)}><Trash2 size={16} aria-hidden />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></td></tr>)}</tbody></table></div>}
    <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle><AlertDialogDescription>Emails already written with this signature stay as they are.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleteSignature.isPending} onClick={(event) => { event.preventDefault(); if (confirmDelete) remove(confirmDelete) }}>{deleteSignature.isPending ? 'Deleting…' : 'Delete'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}
