import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { useCreateOrg } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'

/**
 * The second onboarding step: the user has an account and a name, and now needs
 * an org to work in.
 *
 * Creating an account no longer creates an org, so this screen is where the
 * first one comes from. Someone who arrived by invite already has a membership
 * and never gets routed here.
 */
export function CreateOrg() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const createOrg = useCreateOrg()

  const [name, setName] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name the organization to create it.')
      return
    }
    try {
      await createOrg.mutateAsync({ name: trimmed })
      // The membership list in the store is what the routing gate reads, so it
      // has to be reloaded before navigating or the gate sends them straight back.
      await refresh()
      navigate('/home', { replace: true })
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not create the organization. Try again.',
      )
    }
  }

  return (
    <div className="mx-auto w-full max-w-md py-8">
      <h1 className="display text-2xl font-bold">Create your organization</h1>
      <p className="mt-1 text-sm text-muted-foreground">Name it after your company.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orgName">
            Organization name <RequiredAsterisk />
          </Label>
          <Input
            id="orgName"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <Button type="submit" disabled={createOrg.isPending}>
          {createOrg.isPending ? 'Creating…' : 'Create organization'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Joining a colleague&rsquo;s organization instead? Ask them for an invite link.
      </p>
    </div>
  )
}
