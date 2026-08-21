import type { ComponentType } from 'react'
import { Building2, User as UserIcon, Users, type LucideIcon } from 'lucide-react'

import { Separator } from '@/components/ui/separator'
import { useUrlString } from '@/hooks/urlState'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_ProfileTab } from './Settings_ProfileTab'
import { Settings_OrganizationTab } from './Settings_OrganizationTab'
import { Settings_MembersTab } from './Settings_MembersTab'

type TabId = 'profile' | 'organization' | 'members'

interface TabDef {
  id: TabId
  label: string
  icon: LucideIcon
  /** Requires an active org to have anything to show. */
  needsOrg?: boolean
  /** Requires admin authority in the active org. */
  adminOnly?: boolean
}

const TABS: TabDef[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'organization', label: 'Organization', icon: Building2, needsOrg: true },
  { id: 'members', label: 'Members', icon: Users, needsOrg: true, adminOnly: true },
]

const TAB_CONTENT: Record<TabId, ComponentType> = {
  profile: Settings_ProfileTab,
  organization: Settings_OrganizationTab,
  members: Settings_MembersTab,
}

/**
 * Profile and organization settings.
 *
 * The Organization and Members tabs act on the ACTIVE org, which the switcher in
 * the sidebar changes. Both are hidden for a user who belongs to no org yet, and
 * Members is hidden from a non-admin of that org — there is nothing for either
 * to see (CLAUDE.md → never ship a live-looking control that does nothing).
 */
export function Settings() {
  const { org, isAdmin } = useAuth()
  const [tabParam, setTabParam] = useUrlString('tab', 'profile')

  const visibleTabs = TABS.filter((tab) => {
    if (tab.needsOrg && !org) return false
    if (tab.adminOnly && !isAdmin) return false
    return true
  })

  const activeTab: TabId = visibleTabs.find((tab) => tab.id === tabParam)?.id ?? 'profile'
  const ActiveTabContent = TAB_CONTENT[activeTab]

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-base font-semibold">Settings</h1>

      <Separator className="my-8" />

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-40 md:flex-col" aria-label="Settings">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setTabParam(tab.id)}
                className={cn(
                  'flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            )
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <ActiveTabContent />
        </div>
      </div>
    </div>
  )
}
