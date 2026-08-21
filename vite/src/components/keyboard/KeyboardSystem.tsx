import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { KeyboardSystemContext } from './keyboardContext'

export type KeyboardCommandGroup = 'Records' | 'Actions' | 'Views' | 'Settings'

export interface KeyboardCommand {
  id: string
  title: string
  group: KeyboardCommandGroup
  keywords?: string[]
  shortcut?: string
  execute: () => void | 'opens-dialog'
}

interface KeyboardSystemProps {
  commands: KeyboardCommand[]
  children?: ReactNode
}

const GROUPS: KeyboardCommandGroup[] = ['Records', 'Actions', 'Views', 'Settings']

/**
 * The shared command surface. Every command displayed here uses the same callback
 * as its keyboard binding, so the shortcut help never promises an action it cannot run.
 */
export function KeyboardSystem({ commands, children }: KeyboardSystemProps) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const previousFocus = useRef<HTMLElement | null>(null)

  const allCommands = useMemo<KeyboardCommand[]>(
    () => [
      ...commands,
      {
        id: 'show-keyboard-shortcuts',
        title: 'Show keyboard shortcuts',
        group: 'Actions',
        shortcut: '?',
        execute: () => {
          setPaletteOpen(false)
          setShortcutsOpen(true)
          return 'opens-dialog'
        },
      },
    ],
    [commands],
  )

  const groupedCommands = useMemo(
    () => GROUPS.map((group) => ({ group, commands: allCommands.filter((command) => command.group === group) })),
    [allCommands],
  )

  const rememberFocus = useCallback(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])

  const restoreFocus = useCallback(() => {
    queueMicrotask(() => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
    })
  }, [])

  const setPalette = useCallback((nextOpen: boolean) => {
    if (nextOpen) rememberFocus()
    setPaletteOpen(nextOpen)
    if (!nextOpen) restoreFocus()
  }, [rememberFocus, restoreFocus])

  const setShortcuts = useCallback((nextOpen: boolean) => {
    if (nextOpen) rememberFocus()
    setShortcutsOpen(nextOpen)
    if (!nextOpen) restoreFocus()
  }, [rememberFocus, restoreFocus])

  const run = useCallback((command: KeyboardCommand) => {
    setPaletteOpen(false)
    setShortcutsOpen(false)
    if (command.execute() !== 'opens-dialog') restoreFocus()
  }, [restoreFocus])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(true)
        return
      }

      if (event.key === '?' && !hasModifier(event) && !isTypingTarget(event.target)) {
        event.preventDefault()
        setShortcuts(true)
        return
      }

      if (event.defaultPrevented || hasModifier(event) || isTypingTarget(event.target)) return

      const command = allCommands.find((candidate) => candidate.shortcut?.toLowerCase() === event.key.toLowerCase())
      if (!command) return

      event.preventDefault()
      run(command)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [allCommands, run, setPalette, setShortcuts])

  return (
    <KeyboardSystemContext.Provider value={{ openPalette: () => setPalette(true), openShortcuts: () => setShortcuts(true) }}>
      {children}
      <Palette commands={groupedCommands} open={paletteOpen} onOpenChange={setPalette} onSelect={run} />
      <Shortcuts commands={groupedCommands} open={shortcutsOpen} onOpenChange={setShortcuts} />
    </KeyboardSystemContext.Provider>
  )
}

function Palette({
  commands,
  open,
  onOpenChange,
  onSelect,
}: {
  commands: { group: KeyboardCommandGroup; commands: KeyboardCommand[] }[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (command: KeyboardCommand) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-md border-border bg-popover p-0 shadow-md" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Find a page or action.</DialogDescription>
        </DialogHeader>
        <Command label="Command palette" className="text-sm">
          <Command.Input
            autoFocus
            placeholder="Find a page or action"
            className="h-8 w-full border-b border-border bg-bg px-3 text-sm outline-none placeholder:text-text-muted"
          />
          <Command.List className="max-h-64 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-2 text-sm text-text-muted">No matches.</Command.Empty>
            {commands.map(({ group, commands: groupCommands }) =>
              groupCommands.length > 0 ? (
                <Command.Group key={group} heading={group} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-muted">
                  {groupCommands.map((command) => (
                    <Command.Item
                      key={command.id}
                      value={[command.title, ...(command.keywords ?? [])].join(' ')}
                      onSelect={() => onSelect(command)}
                      className="flex h-8 cursor-pointer items-center gap-3 rounded-md px-3 text-sm aria-selected:bg-surface-2"
                    >
                      <span className="flex-1">{command.title}</span>
                      {command.shortcut ? <Shortcut keys={command.shortcut} /> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null,
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function Shortcuts({
  commands,
  open,
  onOpenChange,
}: {
  commands: { group: KeyboardCommandGroup; commands: KeyboardCommand[] }[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const visibleGroups = commands
    .map(({ group, commands: groupCommands }) => ({
      group,
      commands: groupCommands.filter(
        (command) => !normalizedQuery || `${command.title} ${command.shortcut ?? ''}`.toLowerCase().includes(normalizedQuery),
      ),
    }))
    .filter(({ commands: groupCommands }) => groupCommands.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 rounded-md border-border bg-popover p-0 shadow-md" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts available on this page.</DialogDescription>
        </DialogHeader>
        <div className="border-b border-border p-3">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search shortcuts"
            placeholder="Search shortcuts"
            className="h-8 w-full rounded-md border border-border bg-bg px-3 text-sm outline-none placeholder:text-text-muted focus:border-primary"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {visibleGroups.map(({ group, commands: groupCommands }) => (
            <section key={group} aria-labelledby={`${group}-shortcuts`} className="py-1">
              <h2 id={`${group}-shortcuts`} className="px-3 py-1 text-xs font-medium text-text-muted">
                {group}
              </h2>
              {groupCommands.map((command) => (
                <div key={command.id} className="flex h-8 items-center gap-3 rounded-md px-3 text-sm">
                  <span className="flex-1">{command.title}</span>
                  {command.shortcut ? <Shortcut keys={command.shortcut} /> : null}
                </div>
              ))}
            </section>
          ))}
          {visibleGroups.length === 0 ? <p className="px-3 py-2 text-sm text-text-muted">No shortcuts match.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Shortcut({ keys }: { keys: string }) {
  return <kbd className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-muted">{keys}</kbd>
}

function hasModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
