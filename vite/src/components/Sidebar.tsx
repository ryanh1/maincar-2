import { Home, LogOut, Pencil, Phone, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { useComposerOptional } from '@/components/composer/composerContext'
import { useIsDesktop } from '@/components/composer/desktopOnly'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

const NAV = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/calls', label: 'Calls', icon: Phone },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut } = useAuth()
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email

  // Compose is drawn only where it can actually open something. Below `lg` the
  // dock is gone (see `desktopOnly.ts`), and outside `ComposerProvider` there is
  // no state to open a card into — a button in either case would be a
  // live-looking control that does nothing.
  const composer = useComposerOptional()
  const isDesktop = useIsDesktop()

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

        {composer && isDesktop && (
          <div className="p-3 pb-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => void composer.openComposer()}
                  >
                    <Pencil size={16} />
                    Compose
                  </Button>
                </TooltipTrigger>
                {/* The provider is local because the app mounts none at the root. */}
                <TooltipContent side="right">Press c to compose.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'hover:bg-white/5',
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
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
