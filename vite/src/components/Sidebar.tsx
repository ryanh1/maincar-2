import { Database, Home, List, LogOut, Phone, Settings } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { Button } from '@/components/ui/button'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import { useGetLists, useGetObjects } from '@/hooks/crm'
import { useGetIntegrationHealth } from '@/hooks/integrations'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

const NAV = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/calls', label: 'Calls', icon: Phone },
  { to: '/settings', label: 'Settings', icon: Settings },
]

// The badge deep-links to the Integrations tab, not just to Settings: a rep who is
// not on that page is exactly the one who needs telling. The tab is selected by the
// `tab` query param (Settings.tsx), so the fix is one click away.
const INTEGRATIONS_TAB = '/settings?tab=integrations'

/**
 * The badge's accessible name. It names the problem AND the fix, never a bare number
 * — a screen reader hearing "3" learns nothing (rules/copy.md → say what to do). One
 * sentence, imperative, so it survives the flow.
 */
function brokenBadgeLabel(count: number): string {
  return count === 1
    ? 'Reconnect 1 broken email connection in Integrations.'
    : `Reconnect ${count} broken email connections in Integrations.`
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut, org } = useAuth()
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email

  // Only genuinely broken (status='error') connections — the health endpoint already
  // excludes deliberately-limited ones, so a rep who withheld a permission never
  // raises a permanent alarm (SPEC-int-health.md). The hook disables itself without an
  // org, so nothing fetches for a user who has none yet.
  const health = useGetIntegrationHealth(org?.id)
  const brokenCount = health.data?.broken.length ?? 0
  const objects = (useGetObjects(org?.id).data?.objects ?? []).filter(
    (object) => !object.isHidden && !object.isArchived,
  )
  const lists = (useGetLists(org?.id).data?.lists ?? []).filter((list) => !list.isArchived)

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-56 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <span className="display font-bold tracking-tight text-white">{APP_NAME}</span>
        </div>

        <div className="border-b border-sidebar-border p-3">
          <OrgSwitcher />
        </div>

        <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          <NavSection label="Favorites">
            {NAV.map(({ to, label, icon: Icon }) => {
            // The badge rides the Settings row, but is its own link so a click lands on
            // the Integrations tab rather than the default Settings tab. Rendered as a
            // sibling, never a child of the NavLink — an anchor inside an anchor is
            // invalid, so absolute positioning does the overlap instead.
            const showBrokenBadge = to === '/settings' && brokenCount > 0
            return (
              <div key={to} className="relative">
                <NavLink
                  to={to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'hover:bg-white/5',
                      // Keep the label clear of the badge floating on the right.
                      showBrokenBadge && 'pr-12',
                    )
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
                {showBrokenBadge && (
                  <Link
                    to={INTEGRATIONS_TAB}
                    onClick={onClose}
                    aria-label={brokenBadgeLabel(brokenCount)}
                    className="absolute right-3 top-1/2 flex h-4 min-w-4 -translate-y-1/2 items-center justify-center rounded-full bg-status-failed px-1 text-xs font-medium tabular-nums text-white"
                  >
                    {/* Hidden from the reader that already hears the label above, so the
                        count is not announced a second time as a bare number. */}
                    <span aria-hidden="true">{brokenCount}</span>
                  </Link>
                )}
              </div>
            )
            })}
          </NavSection>

          <NavSection label="Records">
            {objects.map((object) => (
              <NavLink
                key={object.id}
                to={`/records/${object.slug}`}
                onClick={onClose}
                className={({ isActive }) => navRowClass(isActive)}
              >
                <Database size={16} aria-hidden />
                {object.namePlural}
              </NavLink>
            ))}
          </NavSection>

          <NavSection label="Lists">
            {lists.map((list) => (
              <NavLink
                key={list.id}
                to={`/lists/${list.id}`}
                onClick={onClose}
                className={({ isActive }) => navRowClass(isActive)}
              >
                <List size={16} aria-hidden />
                {list.name}
              </NavLink>
            ))}
          </NavSection>
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <p className="truncate px-1 pb-2 text-xs text-sidebar-foreground/70">{displayName}</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-white/5 hover:text-white"
            onClick={() => void signOut()}
          >
            <LogOut size={16} />
            Sign out
          </Button>
        </div>
      </aside>
    </>
  )
}

function NavSection({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section className="flex flex-col gap-1" aria-label={label}>
      <h2 className="px-3 text-xs font-medium text-sidebar-foreground/70">{label}</h2>
      {children}
    </section>
  )
}

function navRowClass(isActive: boolean): string {
  return cn(
    'flex h-8 items-center gap-3 rounded-md px-3 text-sm transition-colors',
    isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-white/5',
  )
}
