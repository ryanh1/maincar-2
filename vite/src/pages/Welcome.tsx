import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { useUpdateProfile } from '@/hooks/profile'
import { useAuth } from '@/providers/useAuth'

export function Welcome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const updateProfile = useUpdateProfile()

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [title, setTitle] = useState(user?.title ?? '')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      const me = await updateProfile.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        // Default the zone from the browser. Every time shown to this user is
        // rendered in it (CLAUDE.md → Dates & Times).
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })

      // Pick the destination here rather than navigating to /home and letting
      // ProtectedLayout bounce on. Two navigations in one tick leave the router
      // rendering a <Navigate> whose effect never runs, and the screen goes blank
      // until a reload. The response just told us whether an org exists, so use it.
      navigate(me.memberships.length === 0 ? '/create-org' : '/home', { replace: true })
    } catch {
      toast.error('Your details could not be saved. Try again.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-md py-8">
      <h1 className="display text-2xl font-bold">Tell us who you are</h1>

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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Job title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <Button type="submit" disabled={updateProfile.isPending}>
          {updateProfile.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </div>
  )
}
