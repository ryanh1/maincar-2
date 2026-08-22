import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useGetDispositions } from '@/hooks/dispositions'
import { useLogCallDisposition } from '@/hooks/dialer'
import type { CallDetail } from '@/lib/callTypes'

export function CallDetail_DispositionForm({ orgId, call }: { orgId: string; call: CallDetail }) {
  const dispositionsQuery = useGetDispositions(orgId)
  const logDisposition = useLogCallDisposition(orgId, call.id)
  const [dispositionId, setDispositionId] = useState(call.disposition?.id ?? '')
  const [noteText, setNoteText] = useState(call.noteText ?? '')

  async function save(): Promise<void> {
    if (!dispositionId) return
    try {
      await logDisposition.mutateAsync({ dispositionId, noteText: noteText || null })
      toast.success('Call outcome saved.')
    } catch {
      toast.error('Could not save the call outcome. Try again.')
    }
  }

  if (dispositionsQuery.isPending) return <section className="border border-border p-3"><p className="text-sm text-text-muted">Loading call outcomes.</p></section>
  if (dispositionsQuery.isError) return <section className="border border-border p-3"><p className="text-sm text-destructive">Could not load call outcomes.</p><Button type="button" className="mt-3" size="sm" variant="secondary" onClick={() => void dispositionsQuery.refetch()}>Try again</Button></section>
  if (!dispositionsQuery.data?.dispositions.length) return <section className="border border-border p-3"><h2 className="text-sm font-semibold">Call outcome</h2><p className="mt-1 text-sm text-text-muted">Add a disposition before logging this call.</p><Button asChild className="mt-3" size="sm" variant="secondary"><Link to="/settings?tab=dispositions">Manage dispositions</Link></Button></section>

  return <section className="border border-border p-3"><h2 className="text-sm font-semibold">Call outcome</h2><div className="mt-3 flex flex-col gap-3"><div className="flex flex-col gap-1"><Label htmlFor="call-disposition">Disposition</Label><Select value={dispositionId} onValueChange={setDispositionId}><SelectTrigger id="call-disposition" className="h-8 w-full"><SelectValue placeholder="Choose an outcome" /></SelectTrigger><SelectContent>{dispositionsQuery.data.dispositions.map((disposition) => <SelectItem key={disposition.id} value={disposition.id}>{disposition.label}</SelectItem>)}</SelectContent></Select></div><div className="flex flex-col gap-1"><Label htmlFor="call-note">Note</Label><Textarea id="call-note" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Add a note" /></div><div><Button type="button" size="sm" disabled={!dispositionId || logDisposition.isPending} onClick={() => void save()}>{logDisposition.isPending ? 'Saving' : 'Save outcome'}</Button></div></div></section>
}
