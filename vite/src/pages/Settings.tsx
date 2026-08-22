import type { ComponentType } from 'react'
import {
  Building2,
  FileText,
  FileSignature,
  Headphones,
  Phone,
  Plug,
  User as UserIcon,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { Separator } from '@/components/ui/separator'
import { useUrlString } from '@/hooks/urlState'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_ProfileTab } from './Settings_ProfileTab'
import { Settings_OrganizationTab } from './Settings_OrganizationTab'
import { Settings_MembersTab } from './Settings_MembersTab'
import { Settings_PhoneNumbersTab } from './Settings_PhoneNumbersTab'
import { Settings_EmailTemplatesTab } from './Settings_EmailTemplatesTab'
import { Settings_EmailSignaturesTab } from './Settings_EmailSignaturesTab'
import { Settings_IntegrationsTab } from './Settings_IntegrationsTab'
import { Settings_DevicesTab } from './Settings_DevicesTab'

type TabId =
  | 'profile'
  | 'organization'
  | 'members'
  | 'numbers'
  | 'email-templates'
  | 'signatures'
  | 'integrations'
  | 'devices'

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
  // Not needsOrg: the mic/speaker check is a property of this browser, not
  // the active organization, so it stays visible for a user with no org yet.
  { id: 'devices', label: 'Devices', icon: Headphones },
  { id: 'organization', label: 'Organization', icon: Building2, needsOrg: true },
  { id: 'members', label: 'Members', icon: Users, needsOrg: true, adminOnly: true },
  { id: 'numbers', label: 'Phone numbers', icon: Phone, needsOrg: true },
  // Not adminOnly: a template belongs to the ORG and any member may write, edit,
  // or delete any of them (SPEC-composer-templates.md § 2).
  { id: 'email-templates', label: 'Email templates', icon: FileText, needsOrg: true },
  { id: 'signatures', label: 'Signatures', icon: FileSignature, needsOrg: true },
  // Hidden for a user with no org, like Organization and Members: connections belong to
  // an org, so there is nothing to show without one.
  { id: 'integrations', label: 'Integrations', icon: Plug, needsOrg: true },
]

const TAB_CONTENT: Record<TabId, ComponentType> = {
  profile: Settings_ProfileTab,
  devices: Settings_DevicesTab,
  organization: Settings_OrganizationTab,
  members: Settings_MembersTab,
  numbers: Settings_PhoneNumbersTab,
  'email-templates': Settings_EmailTemplatesTab,
  signatures: Settings_EmailSignaturesTab,
  integrations: Settings_IntegrationsTab,
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
    // Wide enough for the Members table (Loadwire's settings shell is the same
    // 1024px). The Profile and Organization forms carry their own `max-w-sm`, so
    // widening the shell does not stretch them.
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-base font-semibold">Settings</h1>

      <Separator className="my-8" />

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col" aria-label="Settings">
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
