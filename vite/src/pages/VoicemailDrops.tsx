import { useState } from 'react'
import { Upload, Voicemail } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useDeleteVoicemailDrop,
  useGetVoicemailDrops,
  useRenameVoicemailDrop,
  useSetDefaultVoicemailDrop,
  useUploadVoicemailDrop,
} from '@/hooks/voicemailDrops'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'

import { VoicemailDrops_Row } from './VoicemailDrops_Row'
import { VoicemailDrops_UploadDialog } from './VoicemailDrops_UploadDialog'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** Organization-wide library of reusable voicemail audio. */
export function VoicemailDrops() {
  const { org } = useAuth()
  const query = useGetVoicemailDrops(org?.id)
  const upload = useUploadVoicemailDrop()
  const rename = useRenameVoicemailDrop()
  const setDefault = useSetDefaultVoicemailDrop()
  const remove = useDeleteVoicemailDrop()
  const [uploadOpen, setUploadOpen] = useState(false)
  const drops = query.data?.drops ?? []
  const busy = upload.isPending || rename.isPending || setDefault.isPending || remove.isPending

  if (!org) return null
  const orgId = org.id

  async function renameDrop(dropId: string, name: string): Promise<void> {
    try {
      await rename.mutateAsync({ orgId, dropId, name })
      toast.success('Voicemail drop renamed.')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not rename the voicemail drop. Try again.'))
      throw error
    }
  }

  async function uploadDrop(name: string, file: File): Promise<void> {
    try {
      await upload.mutateAsync({ orgId, name, file })
      toast.success('Voicemail drop uploaded.')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not upload the voicemail drop. Check the file and try again.'))
      throw error
    }
  }

  async function makeDefault(dropId: string): Promise<void> {
    try {
      await setDefault.mutateAsync({ orgId, dropId })
      toast.success('Default voicemail drop updated.')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update the default voicemail drop. Try again.'))
    }
  }

  async function deleteDrop(dropId: string): Promise<void> {
    try {
      await remove.mutateAsync({ orgId, dropId })
      toast.success('Voicemail drop deleted.')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not delete the voicemail drop. Try again.'))
      throw error
    }
  }

  return (
    <main className="mx-auto min-w-0 w-full max-w-5xl">
      <PageHeader
        icon={Voicemail}
        title="Voicemail drops"
        count={query.data?.total}
        action={(
          <Button type="button" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload size={16} aria-hidden />
            Upload drop
          </Button>
        )}
      />

      <div className="flex min-w-0 flex-col gap-3 pt-6">
        {query.isPending && (
          <div aria-label="Loading voicemail drops" className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {query.isError && (
          <div role="alert" className="flex items-center gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-danger">Could not load voicemail drops.</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {!query.isPending && !query.isError && drops.length === 0 && (
          <EmptyState title="Upload the first voicemail drop">
            <p>Use a short recording the rep can send during a call.</p>
          </EmptyState>
        )}
        {drops.length > 0 && (
          <div className="min-w-0 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="w-full">
              <caption className="sr-only">Voicemail drops for {org.name}</caption>
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">Name</th>
                  <th scope="col" className="w-28 px-3 py-2 text-left text-xs font-medium text-text-muted">Duration</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-text-muted">Transcript</th>
                  <th scope="col" className="w-28 px-3 py-2 text-left text-xs font-medium text-text-muted">Default</th>
                  <th scope="col" className="w-24 px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {drops.map((drop) => (
                  <VoicemailDrops_Row
                    key={drop.id}
                    drop={drop}
                    busy={busy}
                    onRename={renameDrop}
                    onSetDefault={makeDefault}
                    onDelete={deleteDrop}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <VoicemailDrops_UploadDialog
        open={uploadOpen}
        busy={upload.isPending}
        onOpenChange={setUploadOpen}
        onUpload={uploadDrop}
      />
    </main>
  )
}
