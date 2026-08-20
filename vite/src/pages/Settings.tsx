import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { Separator } from '@/components/ui/separator'
import { useUpdateProfile } from '@/hooks/profile'
import { useAuth } from '@/providers/useAuth'

export function Settings() {
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
    } catch {
      toast.error('Your profile could not be saved. Try again.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="display text-2xl font-bold">Settings</h1>

      <Separator className="my-8" />

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

          <Button type="submit" className="self-start" disabled={updateProfile.isPending}>
            {updateProfile.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </section>
    </div>
  )
}
