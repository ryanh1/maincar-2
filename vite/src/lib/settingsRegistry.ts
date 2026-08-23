import {
  Building2,
  Bell,
  Database,
  FileSignature,
  FileText,
  Keyboard,
  ListChecks,
  Phone,
  Plug,
  Radio,
  User as UserIcon,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'

import type { SettingsSection } from '@/lib/workspaceUrlState'

export interface SettingsTabDefinition {
  id: SettingsSection
  label: string
  icon: LucideIcon
  needsOrg?: boolean
  adminOnly?: boolean
}

/** One route registry powers Settings navigation and the command palette. */
export const SETTINGS_TABS: SettingsTabDefinition[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'organization', label: 'Organization', icon: Building2, needsOrg: true },
  { id: 'members', label: 'Members', icon: Users, needsOrg: true, adminOnly: true },
  { id: 'teams', label: 'Teams', icon: UsersRound, needsOrg: true },
  { id: 'numbers', label: 'Phone numbers', icon: Phone, needsOrg: true },
  { id: 'call-recordings', label: 'Call recordings', icon: Radio, needsOrg: true },
  { id: 'dispositions', label: 'Call dispositions', icon: ListChecks, needsOrg: true },
  { id: 'next-steps', label: 'Next steps', icon: ListChecks, needsOrg: true, adminOnly: true },
  { id: 'voicemail-greeting', label: 'Voicemail greeting', icon: Radio, needsOrg: true, adminOnly: true },
  { id: 'email-templates', label: 'Email templates', icon: FileText, needsOrg: true },
  { id: 'signatures', label: 'Signatures', icon: FileSignature, needsOrg: true },
  { id: 'integrations', label: 'Integrations', icon: Plug, needsOrg: true },
  { id: 'data-model', label: 'Data model', icon: Database, needsOrg: true, adminOnly: true },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'alerts', label: 'Call alerts', icon: Bell },
]

export function visibleSettingsTabs({ hasOrg, isAdmin }: { hasOrg: boolean; isAdmin: boolean }) {
  return SETTINGS_TABS.filter((tab) => !(tab.needsOrg && !hasOrg) && !(tab.adminOnly && !isAdmin))
}
