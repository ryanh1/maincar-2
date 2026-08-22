import { ArrowLeft, Trash2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetCallDetail } from '@/hooks/dialer'
import { CallDetail_Workbench } from '@/pages/CallDetail_Workbench'
import { CallDetail_DispositionForm } from '@/pages/CallDetail_DispositionForm'
import { useAuth } from '@/providers/useAuth'

const DELETE_UNAVAILABLE = "Deleting call records isn't available yet."

/** A call's CRM context, playback and transcript, in the responsive review frame. */
export function CallDetail() {
  const { id } = useParams<{ id: string }>()
  const { user, org } = useAuth()
  const callQuery = useGetCallDetail(org?.id ?? null, id)
  const call = callQuery.data?.call

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-6">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/calls"><ArrowLeft size={16} aria-hidden />Back</Link>
        </Button>
        <div className="flex flex-col items-end gap-1">
          <Button variant="destructive" size="sm" disabled><Trash2 size={16} aria-hidden />Delete call</Button>
          <p className="text-xs text-text-muted">{DELETE_UNAVAILABLE}</p>
        </div>
      </div>

      {callQuery.isPending && <div className="flex flex-col gap-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /><Skeleton className="h-32 w-full" /></div>}

      {callQuery.isError && (
        <div className="flex items-center gap-3 border border-border p-3">
          <p className="text-sm text-destructive">Could not load this call.</p>
          <Button variant="secondary" size="sm" onClick={() => void callQuery.refetch()}>Try again</Button>
        </div>
      )}

      {call && org && <CallDetail_DispositionForm key={call.id} orgId={org.id} call={call} />}
      {call && <CallDetail_Workbench call={call} timeZone={user?.timeZone} userId={user?.id} />}
    </div>
  )
}
