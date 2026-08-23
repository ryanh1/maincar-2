import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { useComposer } from '@/components/composer/composerContext'
import { useGetKeyboardBindings } from '@/hooks/keyboardBindings'
import { useAuth } from '@/providers/useAuth'

import { KeyboardSystem, type KeyboardCommand } from './KeyboardSystem'
import { applyKeyboardBindings, keyboardActionDefinitions, mergeKeyboardBindings } from './keyboardRegistry'

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
  const bindingsQuery = useGetKeyboardBindings()

  const commands = useMemo<KeyboardCommand[]>(() => {
    function visit(path: string) {
      navigate(path)
      requestAnimationFrame(() => document.getElementById('app-main')?.focus())
    }

    const commands = keyboardActionDefinitions({ hasOrg: !!org, isAdmin }).map((action): KeyboardCommand => ({
      ...action,
      execute: () => {
        if (action.id === 'compose-email') return void openComposer()
        if (action.id === 'view-home') return visit('/home')
        if (action.id === 'view-calls') return visit('/calls')
        if (action.id === 'view-tasks') return visit('/tasks')
        if (action.id === 'settings') return visit('/settings')
        if (action.id.startsWith('settings-')) return visit(`/settings/${action.id.slice('settings-'.length)}`)
      },
    }))

    return applyKeyboardBindings(commands, mergeKeyboardBindings(bindingsQuery.data?.bindings))
  }, [bindingsQuery.data?.bindings, isAdmin, navigate, openComposer, org])

  return <KeyboardSystem commands={commands}>{children}</KeyboardSystem>
}
