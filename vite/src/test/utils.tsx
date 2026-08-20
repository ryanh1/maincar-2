/**
 * Shared helpers for component and hook tests.
 *
 * `renderWithProviders` wraps the UI in a fresh React Query client (retries off,
 * so a failed query settles immediately instead of stalling the test) and a
 * MemoryRouter. Pass `initialEntries` to start on a specific route.
 */
import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

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
      <MemoryRouter initialEntries={opts.initialEntries ?? ['/']}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

export function renderWithProviders(ui: ReactNode, opts: Options = {}): RenderResult {
  return render(withProviders(ui, opts))
}
