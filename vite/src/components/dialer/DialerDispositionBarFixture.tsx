import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DialerDispositionBar } from './DialerDispositionBar'

const queryClient = new QueryClient()

/** Development-only fixture for the dock disposition browser journey. */
export function DialerDispositionBarFixture() {
  return (
    <QueryClientProvider client={queryClient}>
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <section aria-labelledby="disposition-bar-fixture-title" className="w-full max-w-md border border-border bg-card p-4">
          <h1 id="disposition-bar-fixture-title" className="text-base font-semibold">Call outcome fixture</h1>
          <DialerDispositionBar orgId="org-fixture" callId="call-fixture" />
        </section>
      </main>
    </QueryClientProvider>
  )
}
