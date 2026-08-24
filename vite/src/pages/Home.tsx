import { Home as HomeIcon } from 'lucide-react'

import { APP_NAME } from '@/config'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
      <PageHeader icon={HomeIcon} title="Home" />

      <div className="flex flex-col gap-6 pt-6">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium text-text">
            Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
          </p>
          <p className="text-[13px] text-text-muted">
            This is the {APP_NAME} starting point. Build the first screen here.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Your account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-3 text-[13px]">
              <dt className="text-text-muted">Organization</dt>
              <dd>{org?.name ?? 'Not set yet'}</dd>

              <dt className="text-text-muted">Email</dt>
              <dd>{user?.email}</dd>

              <dt className="text-text-muted">Role</dt>
              <dd>{activeRoles.length > 0 ? activeRoles.map(getRoleLabel).join(', ') : 'No org yet'}</dd>

              <dt className="text-text-muted">Time zone</dt>
              <dd>{user?.timeZone ?? 'Not set yet'}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
