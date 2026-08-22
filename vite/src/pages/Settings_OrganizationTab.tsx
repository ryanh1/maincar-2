import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { AvatarPhotoField } from '@/components/AvatarPhotoField'
import { useUpdateOrg, useUpdateOrgAvatar } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'

/**
 * The active org's details.
 *
 * `isAdmin` is admin OF THIS ORG, resolved from the caller's membership. A member
 * of another org who is only a basic member here sees the name read-only rather
 * than a Save button that would 403.
 */
export function Settings_OrganizationTab() {
  const { org, isAdmin } = useAuth()
  const updateOrg = useUpdateOrg()
  const updateAvatar = useUpdateOrgAvatar()

  const [name, setName] = useState(org?.name ?? '')

  if (!org) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name the organization to save it.')
      return
    }
    try {
      await updateOrg.mutateAsync({ orgId: org!.id, name: trimmed })
      toast.success('Organization saved.')
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not save the organization. Try again.',
      )
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold">Organization</h2>

      <div className="mt-4">
        <AvatarPhotoField
          name={org.name ?? 'Organization'}
          avatarUrl={org.avatarUrl}
          disabled={!isAdmin}
          upload={(blob) => updateAvatar.mutateAsync({ orgId: org.id, blob }).then(() => undefined)}
          label="organization"
        />
      </div>

      <form onSubmit={onSubmit} className="mt-6 flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orgName">
            Name <RequiredAsterisk />
          </Label>
          <Input
            id="orgName"
            required
            disabled={!isAdmin}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {!isAdmin && (
            <p className="text-sm text-muted-foreground">Only an admin can rename this.</p>
          )}
        </div>

        {isAdmin && (
          <Button type="submit" className="self-start" disabled={updateOrg.isPending}>
            {updateOrg.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </form>
    </section>
  )
}
