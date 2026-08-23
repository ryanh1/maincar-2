import { visibleSettingsTabs } from '@/lib/settingsRegistry'
import { settingsPath } from '@/lib/workspaceUrlState'

import type { KeyboardCommand, KeyboardCommandGroup } from './KeyboardSystem'

export interface KeyboardActionDefinition {
  id: string
  title: string
  group: KeyboardCommandGroup
  keywords?: string[]
  destructive?: boolean
}

export interface KeyboardBinding {
  actionId: string
  keys: string
}

/** Defaults are code-owned so a new action appears without writing a row per user. */
export const DEFAULT_KEYBOARD_BINDINGS: Record<string, string> = {
  'compose-email': 'C',
}

export function mergeKeyboardBindings(savedBindings: KeyboardBinding[] | undefined): Record<string, string> {
  return {
    ...DEFAULT_KEYBOARD_BINDINGS,
    ...Object.fromEntries((savedBindings ?? []).map((binding) => [binding.actionId, binding.keys])),
  }
}

export function keyboardActionDefinitions({ hasOrg, isAdmin }: { hasOrg: boolean; isAdmin: boolean }): KeyboardActionDefinition[] {
  return [
    { id: 'compose-email', title: 'Compose email', group: 'Actions', keywords: ['new email message'] },
    { id: 'view-home', title: 'Home', group: 'Views', keywords: ['dashboard'] },
    { id: 'view-calls', title: 'Calls', group: 'Views', keywords: ['call history'] },
    { id: 'view-tasks', title: 'Tasks', group: 'Views', keywords: ['my tasks follow-up reminders'] },
    { id: 'settings', title: 'Settings', group: 'Settings' },
    ...visibleSettingsTabs({ hasOrg, isAdmin }).map((tab) => ({
      id: `settings-${tab.id}`,
      title: tab.label,
      group: 'Settings' as const,
      keywords: ['settings', tab.id, settingsPath(tab.id)],
    })),
  ]
}

export function applyKeyboardBindings(commands: KeyboardCommand[], bindings: Record<string, string>): KeyboardCommand[] {
  return commands.map((command) => ({ ...command, shortcut: bindings[command.id] }))
}
