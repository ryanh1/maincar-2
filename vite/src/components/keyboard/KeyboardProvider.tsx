import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { useComposer } from '@/components/composer/composerContext'
import { useAuth } from '@/providers/useAuth'

import { KeyboardSystem, type KeyboardCommand } from './KeyboardSystem'

interface KeyboardProviderProps {
  children: ReactNode
}

/**
 * App-wide registry for the routes and actions that exist today. New CRM objects,
 * views, and records register here when their data-plane slices land.
 */
export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const navigate = useNavigate()
  const { org, isAdmin } = useAuth()
  const { openComposer } = useComposer()

  const commands = useMemo<KeyboardCommand[]>(() => {
    function visit(path: string) {
      navigate(path)
      requestAnimationFrame(() => document.getElementById('app-main')?.focus())
    }

    const settings: KeyboardCommand[] = [
      { id: 'settings-profile', title: 'Profile', group: 'Settings', keywords: ['settings account'], execute: () => visit('/settings/profile') },
    ]

    if (org) {
      settings.push(
        { id: 'settings-organization', title: 'Organization', group: 'Settings', keywords: ['settings'], execute: () => visit('/settings/organization') },
        { id: 'settings-phone-numbers', title: 'Phone numbers', group: 'Settings', keywords: ['settings calling'], execute: () => visit('/settings/numbers') },
        { id: 'settings-email-templates', title: 'Email templates', group: 'Settings', keywords: ['settings compose'], execute: () => visit('/settings/email-templates') },
        { id: 'settings-integrations', title: 'Integrations', group: 'Settings', keywords: ['settings email'], execute: () => visit('/settings/integrations') },
      )
    }

    if (org && isAdmin) {
      settings.push({ id: 'settings-members', title: 'Members', group: 'Settings', keywords: ['settings team'], execute: () => visit('/settings/members') })
    }

    return [
      { id: 'compose-email', title: 'Compose email', group: 'Actions', shortcut: 'C', keywords: ['new email message'], execute: () => void openComposer() },
      { id: 'view-home', title: 'Home', group: 'Views', keywords: ['dashboard'], execute: () => visit('/home') },
      { id: 'view-calls', title: 'Calls', group: 'Views', keywords: ['call history'], execute: () => visit('/calls') },
      { id: 'settings', title: 'Settings', group: 'Settings', execute: () => visit('/settings') },
      ...settings,
    ]
  }, [isAdmin, navigate, openComposer, org])

  return <KeyboardSystem commands={commands}>{children}</KeyboardSystem>
}
