import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { APP_NAME } from '@/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { useUpdateProfile } from '@/hooks/profile'
import { useAuth } from '@/providers/useAuth'

export function Welcome() {
  const navigate = useNavigate()
  const { user, org, isAdmin } = useAuth()
  const updateProfile = useUpdateProfile()

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [orgName, setOrgName] = useState(org?.name ?? '')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await updateProfile.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(isAdmin ? { orgName: orgName.trim() } : {}),
        // Default the zone from the browser. Every time shown to this user is
        // rendered in it (CLAUDE.md → Dates & Times).
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      navigate('/home', { replace: true })
    } catch {
      toast.error('Your details could not be saved. Try again.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-md py-8">
      <h1 className="display text-2xl font-bold">Welcome to {APP_NAME}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us who you are. This takes a moment and you only do it once.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firstName">
            First name <RequiredAsterisk />
          </Label>
          <Input
            id="firstName"
            required
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
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>

        {isAdmin && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="orgName">
              Organization name <RequiredAsterisk />
            </Label>
            <Input
              id="orgName"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
        )}

        <Button type="submit" disabled={updateProfile.isPending}>
          {updateProfile.isPending ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
