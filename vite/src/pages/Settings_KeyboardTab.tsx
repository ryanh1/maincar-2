import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { keyboardActionDefinitions, mergeKeyboardBindings } from '@/components/keyboard/keyboardRegistry'
import { useGetKeyboardBindings, useUpdateKeyboardBinding } from '@/hooks/keyboardBindings'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/providers/useAuth'

function capturedKeys(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey && event.key === 'Shift') return null
  const modifiers = [
    event.metaKey && 'Cmd',
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
  ].filter(Boolean)
  return [...modifiers, event.key.toUpperCase()].join('+')
}

/** Per-user keyboard bindings. The provider reacts to this query cache immediately. */
export function Settings_KeyboardTab() {
  const { org, isAdmin } = useAuth()
  const bindingsQuery = useGetKeyboardBindings()
  const updateBinding = useUpdateKeyboardBinding()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const actions = useMemo(() => keyboardActionDefinitions({ hasOrg: !!org, isAdmin }), [isAdmin, org])
  const bindings = mergeKeyboardBindings(bindingsQuery.data?.bindings)
  const changedActions = actions.filter((action) => drafts[action.id] !== undefined && drafts[action.id] !== bindings[action.id])

  async function save() {
    try {
      await Promise.all(changedActions.map((action) => updateBinding.mutateAsync({ actionId: action.id, keys: drafts[action.id] })))
      setDrafts({})
      toast.success('Keyboard shortcuts saved.')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save keyboard shortcuts. Try again.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Keyboard shortcuts</CardTitle>
        <CardDescription>Press a key or modifier combination, then save your changes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.map((action) => {
          const value = drafts[action.id] ?? bindings[action.id] ?? ''
          return (
            <label key={action.id} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1">{action.title}</span>
              <Input
                aria-label={`${action.title} shortcut`}
                className="h-8 w-32 text-sm"
                value={value}
                onChange={(event) => setDrafts((current) => ({ ...current, [action.id]: event.target.value }))}
                onKeyDown={(event) => {
                  const keys = capturedKeys(event)
                  if (!keys) return
                  event.preventDefault()
                  setDrafts((current) => ({ ...current, [action.id]: keys }))
                }}
              />
            </label>
          )
        })}
        <Button type="button" size="sm" onClick={() => void save()} disabled={!changedActions.length || updateBinding.isPending}>
          Save shortcuts
        </Button>
      </CardContent>
    </Card>
  )
}
