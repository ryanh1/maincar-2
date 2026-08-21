import { APP_NAME } from '@/config'
import { Separator } from '@/components/ui/separator'
import { getRoleLabel } from '@/lib/roles'
import { useAuth } from '@/providers/useAuth'

export function Home() {
  const { user, org, memberships } = useAuth()

  // The role that matters is the one held IN THE ACTIVE ORG, not `user.roles`
  // (those are global platform roles). Showing the global set here would tell an
  // admin of this org that they are "Basic".
  const activeRoles = memberships.find((m) => m.orgId === org?.id)?.roles ?? []

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="display text-2xl font-bold">
        Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This is the {APP_NAME} starting point. Build the first screen here.
      </p>

      <Separator className="my-8" />

      {/* House rule: main content sections are plain <section> elements with an
          <h2> and a <Separator>. No bordered Card wrappers.
          (CLAUDE.md → UI Components → Section Containers / Cards) */}
      <section>
        <h2 className="text-base font-semibold">Your account</h2>
        <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-3 text-sm">
          <dt className="text-muted-foreground">Organization</dt>
          <dd>{org?.name ?? 'Not set yet'}</dd>

          <dt className="text-muted-foreground">Email</dt>
          <dd>{user?.email}</dd>

          <dt className="text-muted-foreground">Role</dt>
          <dd>{activeRoles.length > 0 ? activeRoles.map(getRoleLabel).join(', ') : 'No org yet'}</dd>

          <dt className="text-muted-foreground">Time zone</dt>
          <dd>{user?.timeZone ?? 'Not set yet'}</dd>
        </dl>
      </section>
    </div>
  )
}
