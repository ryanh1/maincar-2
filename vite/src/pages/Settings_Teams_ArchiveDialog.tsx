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
import { useUpdateTeam } from '@/hooks/teams'
import type { Team } from '@/hooks/teams'
import { ApiError } from '@/lib/api'

interface Props {
  orgId: string
  team: Team | null
  onOpenChange: (open: boolean) => void
}

export function Settings_Teams_ArchiveDialog({ orgId, team, onOpenChange }: Props) {
  const updateTeam = useUpdateTeam()

  async function archive(): Promise<void> {
    if (!team) return
    try {
      await updateTeam.mutateAsync({ orgId, teamId: team.id, isArchived: true })
      toast.success('Team archived.')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not archive the team. Check your connection and try again.')
    }
  }

  return (
    <AlertDialog open={Boolean(team)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {team?.name}?</AlertDialogTitle>
          <AlertDialogDescription>People and CRM records are kept. Team filters stop matching. You can recover it for 30 days.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void archive()}>Archive team</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
