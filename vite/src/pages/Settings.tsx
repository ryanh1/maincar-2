import type { ComponentType } from 'react'
import { Navigate, NavLink, useLocation, useParams } from 'react-router-dom'

import { Separator } from '@/components/ui/separator'
import { legacySettingsPath, settingsPath, type SettingsSection } from '@/lib/workspaceUrlState'
import { visibleSettingsTabs } from '@/lib/settingsRegistry'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

import { Settings_ProfileTab } from './Settings_ProfileTab'
import { Settings_OrganizationTab } from './Settings_OrganizationTab'
import { Settings_MembersTab } from './Settings_MembersTab'
import { Settings_PhoneNumbersTab } from './Settings_PhoneNumbersTab'
import { Settings_EmailTemplatesTab } from './Settings_EmailTemplatesTab'
import { Settings_EmailSignaturesTab } from './Settings_EmailSignaturesTab'
import { Settings_IntegrationsTab } from './Settings_IntegrationsTab'
import { Settings_CallRecordingsTab } from './Settings_CallRecordingsTab'
import { Settings_VoicemailGreetingTab } from './Settings_VoicemailGreetingTab'
import { Settings_DispositionsTab } from './Settings_DispositionsTab'
import { Settings_TeamsTab } from './Settings_TeamsTab'
import { Settings_NextStepsTab } from './Settings_NextStepsTab'
import { Settings_DataModelTab } from './Settings_DataModelTab'
import { Settings_KeyboardTab } from './Settings_KeyboardTab'

type TabId = SettingsSection

const TAB_CONTENT: Record<TabId, ComponentType> = {
  profile: Settings_ProfileTab,
  organization: Settings_OrganizationTab,
  members: Settings_MembersTab,
  numbers: Settings_PhoneNumbersTab,
  'call-recordings': Settings_CallRecordingsTab,
  dispositions: Settings_DispositionsTab,
  'next-steps': Settings_NextStepsTab,
  'voicemail-greeting': Settings_VoicemailGreetingTab,
  'email-templates': Settings_EmailTemplatesTab,
  signatures: Settings_EmailSignaturesTab,
integrations: Settings_IntegrationsTab,
  teams: Settings_TeamsTab,
  'data-model': Settings_DataModelTab,
  keyboard: Settings_KeyboardTab,
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
  const { section } = useParams<{ section: string }>()

  const visibleTabs = visibleSettingsTabs({ hasOrg: !!org, isAdmin })

  const activeTab: TabId = visibleTabs.find((tab) => tab.id === section)?.id ?? 'profile'
  const ActiveTabContent = TAB_CONTENT[activeTab]

  if (section !== undefined && section !== activeTab) return <Navigate to={settingsPath(activeTab)} replace />

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
              <NavLink
                key={tab.id}
                aria-current={isActive ? 'page' : undefined}
                to={settingsPath(tab.id)}
                className={cn(
                  'flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                <Icon size={16} />
                {tab.label}
              </NavLink>
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

/** Drops legacy query parameters while preserving the requested Settings section. */
export function SettingsLegacyRedirect() {
  const { search } = useLocation()
  return <Navigate to={legacySettingsPath(new URLSearchParams(search).get('tab'))} replace />
}
