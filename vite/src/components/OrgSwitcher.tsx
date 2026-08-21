import { useState } from 'react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateOrg, useSwitchOrg } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'

/**
 * Switches the active org, and creates new ones.
 *
 * The list comes from `useAuth().memberships` rather than its own query: /auth/me
 * already returns it, so a second request would only race the first and let the
 * two disagree about which orgs the user belongs to.
 */
export function OrgSwitcher() {
  const { org, memberships, refresh } = useAuth()
  const switchOrg = useSwitchOrg()
  const createOrg = useCreateOrg()

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  async function onSwitch(orgId: string) {
    if (orgId === org?.id) return
    try {
      await switchOrg.mutateAsync(orgId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not switch. Try again.')
    }
  }

  async function onCreate() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name the organization to create it.')
      return
    }
    try {
      await createOrg.mutateAsync({ name: trimmed })
      // The server makes the new org active, so re-read /auth/me to pick up both
      // the new membership and the switch in one round trip.
      await refresh()
      setCreating(false)
      setName('')
      toast.success('Organization created.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create it. Try again.')
    }
  }

  // A user with no org has nothing to switch between, and the create flow lives
  // in onboarding. Rendering a dead control here would be worse than nothing.
  if (!org) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-white/5"
            disabled={switchOrg.isPending}
          >
            <span className="truncate font-medium">{org.name ?? 'Untitled'}</span>
            <ChevronDown size={16} className="shrink-0 opacity-70" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          {memberships.map((membership) => (
            <DropdownMenuItem
              key={membership.orgId}
              onSelect={() => void onSwitch(membership.orgId)}
            >
              <span className="truncate">{membership.org.name ?? 'Untitled'}</span>
              {membership.orgId === org.id && <Check size={16} className="ml-auto" />}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus size={16} />
            New organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New organization</DialogTitle>
            <DialogDescription>Name it after your company.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newOrgName">Name</Label>
            <Input
              id="newOrgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onCreate()
              }}
            />
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onCreate()} disabled={createOrg.isPending}>
              {createOrg.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
