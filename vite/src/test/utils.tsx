/**
 * Shared helpers for component and hook tests.
 *
 * `renderWithProviders` wraps the UI in a fresh React Query client (retries off,
 * so a failed query settles immediately instead of stalling the test), a
 * MemoryRouter, and a TooltipProvider. Pass `initialEntries` to start on a
 * specific route.
 *
 * The TooltipProvider mirrors the one App.tsx mounts at the root. Radix throws
 * if a Tooltip has no provider above it, and any screen with an icon-only
 * button has one, so leaving it out here would fail tests for a reason that
 * does not exist in the running app.
 */
import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import { TooltipProvider } from '@/components/ui/tooltip'

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

interface Options {
  initialEntries?: string[]
  client?: QueryClient
}

export function withProviders(ui: ReactNode, opts: Options = {}): ReactElement {
  const client = opts.client ?? makeTestQueryClient()
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={opts.initialEntries ?? ['/']}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export function renderWithProviders(ui: ReactNode, opts: Options = {}): RenderResult {
  return render(withProviders(ui, opts))
}
