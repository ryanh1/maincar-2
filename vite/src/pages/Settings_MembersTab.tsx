import { useState, type FormEvent } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  memberDisplayName,
  useCreateInvitation,
  useGetInvitations,
  useGetMembers,
  useRegenerateInvitation,
  useRevokeInvitation,
} from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/datetime'
import { getRoleLabel } from '@/lib/roles'
import { useAuth } from '@/providers/useAuth'

/** How long the copied-checkmark stays up, per CLAUDE.md → Copy Button Feedback. */
const COPIED_MS = 1500

export function Settings_MembersTab() {
  const { user, org, isAdmin } = useAuth()
  const orgId = org?.id ?? null

  const membersQuery = useGetMembers(orgId)
  const invitationsQuery = useGetInvitations(orgId, isAdmin)
  const createInvitation = useCreateInvitation()
  const revokeInvitation = useRevokeInvitation()
  const regenerateInvitation = useRegenerateInvitation()

  const [email, setEmail] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<{ id: string; email: string } | null>(null)

  if (!org) return null

  async function invite(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      toast.error('Enter an email address to send an invite.')
      return
    }
    try {
      await createInvitation.mutateAsync({ orgId: org!.id, email: trimmed })
      setEmail('')
      toast.success('Invite created. Copy the link to send it.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create the invite. Try again.')
    }
  }

  async function copyLink(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), COPIED_MS)
    } catch {
      toast.error('Could not copy the link. Copy it from the address bar instead.')
    }
  }

  async function regenerate(invitationId: string) {
    try {
      await regenerateInvitation.mutateAsync({ orgId: org!.id, invitationId })
      toast.success('New link created. The old link no longer works.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create a new link. Try again.')
    }
  }

  async function confirmRevoke() {
    if (!revoking) return
    const target = revoking
    setRevoking(null)
    try {
      await revokeInvitation.mutateAsync({ orgId: org!.id, invitationId: target.id })
      toast.success('Invite revoked.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not revoke the invite. Try again.')
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-base font-semibold">Members</h2>

        {membersQuery.isPending && (
          <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {membersQuery.isError && (
          <p className="mt-4 text-sm text-destructive">Could not load members. Refresh to retry.</p>
        )}

        {membersQuery.data && (
          <ul className="mt-4 flex flex-col">
            {membersQuery.data.members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{memberDisplayName(member)}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {member.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {getRoleLabel(role)}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin && (
        <>
          <Separator />

          <section>
            <h2 className="text-base font-semibold">Invite someone</h2>

            <form onSubmit={invite} className="mt-4 flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inviteEmail">Email</Label>
                <Input
                  id="inviteEmail"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="self-start" disabled={createInvitation.isPending}>
                {createInvitation.isPending ? 'Creating…' : 'Create invite'}
              </Button>
            </form>

            {/* No mail is sent yet, so the link is shown for the admin to pass on.
                Saying "invite sent" here would be a lie. */}
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Maincar does not send the email yet. Copy the link and send it yourself.
            </p>

            {invitationsQuery.data && invitationsQuery.data.length > 0 && (
              <ul className="mt-6 flex flex-col">
                {invitationsQuery.data.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{invitation.email}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {invitation.roles.map(getRoleLabel).join(', ')} &middot; expires{' '}
                        {formatDateTime(invitation.expiresAt, user?.timeZone)}
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
                        size="sm"
                        disabled={regenerateInvitation.isPending}
                        aria-label={`Create a new link for ${invitation.email}`}
                        onClick={() => void regenerate(invitation.id)}
                      >
                        <RefreshCw size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Revoke the invite for ${invitation.email}`}
                        onClick={() => setRevoking({ id: invitation.id, email: invitation.email })}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

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
    </div>
  )
}
