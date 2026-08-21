import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { useUpdateProfile } from '@/hooks/profile'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'

/** The signed-in user's own profile. Not org-scoped: it follows them everywhere. */
export function Settings_ProfileTab() {
  const { user } = useAuth()
  const updateProfile = useUpdateProfile()

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [title, setTitle] = useState(user?.title ?? '')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await updateProfile.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        title: title.trim() || null,
      })
      toast.success('Your profile is saved.')
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not save your profile. Try again.',
      )
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold">Your profile</h2>

      <form onSubmit={onSubmit} className="mt-4 flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firstName">
            First name <RequiredAsterisk />
          </Label>
          <Input
            id="firstName"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lastName">
            Last name <RequiredAsterisk />
          </Label>
          <Input
            id="lastName"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Job title</Label>
          <Input
            id="title"
            autoComplete="organization-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          {/* Read-only: the address is the Firebase identity, so changing it here
              would put the row and the auth account out of step. */}
          <Input id="email" value={user?.email ?? ''} disabled />
        </div>

        <Button type="submit" className="self-start" disabled={updateProfile.isPending}>
          {updateProfile.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </section>
  )
}
