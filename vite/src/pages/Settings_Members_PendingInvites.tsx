import { useState } from 'react'
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react'
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
import { useGetInvitations, useRegenerateInvitation, useRevokeInvitation } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/datetime'
import { getRoleLabel } from '@/lib/roles'

/** How long the copied checkmark stays up, per the design system. */
const COPIED_MS = 1500

interface Props {
  orgId: string
  enabled: boolean
  /**
   * The viewing admin's zone. Not read here any more: the only time this row
   * shows is the expiry, and that renders in the INVITER's zone — see the render
   * below. Kept on the props so the parent screen keeps passing one thing to all
   * of its sections.
   */
  timeZone: string | null | undefined
}

/** Invites that have been created but not yet accepted. Admin-only on the server. */
export function Settings_Members_PendingInvites({ orgId, enabled }: Props) {
  const invitationsQuery = useGetInvitations(orgId, enabled)
  const revokeInvitation = useRevokeInvitation()
  const regenerateInvitation = useRegenerateInvitation()

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<{ id: string; email: string } | null>(null)

  const invitations = invitationsQuery.data ?? []

  async function copyLink(id: string, url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), COPIED_MS)
    } catch {
      toast.error('Could not copy the link. Copy it from the address bar instead.')
    }
  }

  async function regenerate(invitationId: string): Promise<void> {
    try {
      await regenerateInvitation.mutateAsync({ orgId, invitationId })
      toast.success('New link created. The old link no longer works.')
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not create a new link. Try again.',
      )
    }
  }

  async function confirmRevoke(): Promise<void> {
    if (!revoking) return
    const target = revoking
    setRevoking(null)
    try {
      await revokeInvitation.mutateAsync({ orgId, invitationId: target.id })
      toast.success('Invite revoked.')
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not revoke the invite. Try again.',
      )
    }
  }

  if (invitations.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Pending invites</h2>

      <ul className="flex flex-col rounded-md border border-border">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex items-center justify-between gap-4 border-b border-border px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{invitation.email}</p>
              {/* A date, with no time and no zone label (CLAUDE.md → Dates &
                  Times carves date-only values out of the zone-label rule). The
                  exact minute an invite dies is not a thing anyone acts on.

                  The zone passed is the INVITER's, not the viewer's. The stored
                  instant is the last millisecond of a day on the inviter's clock,
                  so reading it in a viewer's zone lands on the day before or
                  after for anyone far enough away — two admins would see two
                  different dates for the same invite, and neither would match the
                  date the inviter set. Rendering in the anchor zone gives every
                  reader the one date that was actually chosen. */}
              <p className="truncate text-xs text-muted-foreground">
                {invitation.roles.map(getRoleLabel).join(', ')} &middot; expires{' '}
                {formatDate(invitation.expiresAt, invitation.expiresAtTimeZone)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copyLink(invitation.id, invitation.inviteUrl)}
              >
                {copiedId === invitation.id ? <Check size={16} /> : <Copy size={16} />}
                Copy link
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={regenerateInvitation.isPending}
                aria-label={`Create a new link for ${invitation.email}`}
                onClick={() => void regenerate(invitation.id)}
              >
                <RefreshCw size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke the invite for ${invitation.email}`}
                onClick={() => setRevoking({ id: invitation.id, email: invitation.email })}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invite?</AlertDialogTitle>
            <AlertDialogDescription>
              The link stops working. {revoking?.email} cannot join with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* `variant`, not a buttonVariants() className: this AlertDialogAction
                renders a Button internally, so a className would fight the
                variant classes it already applies and the default would win. */}
            <AlertDialogAction variant="destructive" onClick={() => void confirmRevoke()}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
