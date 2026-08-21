import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleMultiSelect, type AssignableRole } from '@/components/ui/RoleMultiSelect'
import { useCreateInvitation } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'

/**
 * Invite someone by email. The link is copied from the pending list below.
 *
 * The role control is the SAME multi-select the member list uses, because an
 * invite grants the roles a membership will hold, and a membership can hold more
 * than one. A single-value select here would make the invite unable to express
 * what the list can.
 */
export function Settings_Members_InviteForm({ orgId }: { orgId: string }) {
  const createInvitation = useCreateInvitation()
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<AssignableRole[]>(['basic'])

  async function invite(event: FormEvent): Promise<void> {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      toast.error('Enter an email address to send an invite.')
      return
    }
    // Refused rather than defaulted, the same way the member list refuses it.
    // An invite carrying no role would land someone in the org with no access.
    if (roles.length === 0) {
      toast.error('Pick at least one role.')
      return
    }
    try {
      await createInvitation.mutateAsync({ orgId, email: trimmed, roles })
      setEmail('')
      setRoles(['basic'])
      toast.success('Invite created. Copy the link to send it.')
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not create the invite. Try again.',
      )
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Invite someone</h2>

      <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="inviteEmail">Email</Label>
          <Input
            id="inviteEmail"
            type="email"
            required
            autoComplete="email"
            className="h-8"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inviteRoles">Roles</Label>
          <RoleMultiSelect
            id="inviteRoles"
            value={roles}
            onChange={setRoles}
            label="Roles"
          />
        </div>
        <Button type="submit" size="sm" disabled={createInvitation.isPending}>
          {createInvitation.isPending ? 'Creating…' : 'Create invite'}
        </Button>
      </form>

      {/* No mail is sent yet, so say so. Claiming "invite sent" would be a lie. */}
      <p className="text-xs text-muted-foreground">
        Maincar does not send the email yet. Copy the link and send it yourself.
      </p>
    </section>
  )
}
