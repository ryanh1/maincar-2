import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/providers/useAuth'

import { Settings_ProfileTab } from './Settings_ProfileTab'
import { Settings_OrganizationTab } from './Settings_OrganizationTab'
import { Settings_MembersTab } from './Settings_MembersTab'

/**
 * Profile and organization settings.
 *
 * The Organization and Members tabs act on the ACTIVE org, which the switcher in
 * the sidebar changes. They are hidden for a user who belongs to no org yet,
 * because there is nothing for them to edit (CLAUDE.md → never ship a
 * live-looking control that does nothing).
 */
export function Settings() {
  const { org } = useAuth()

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="display text-2xl font-bold">Settings</h1>

      <Separator className="my-8" />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {org && <TabsTrigger value="organization">Organization</TabsTrigger>}
          {org && <TabsTrigger value="members">Members</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="pt-6">
          <Settings_ProfileTab />
        </TabsContent>

        {org && (
          <TabsContent value="organization" className="pt-6">
            <Settings_OrganizationTab />
          </TabsContent>
        )}

        {org && (
          <TabsContent value="members" className="pt-6">
            <Settings_MembersTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
