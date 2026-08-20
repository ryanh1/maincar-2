import { useRouteError } from 'react-router-dom'

import { Button } from '@/components/ui/button'

// Rendered by react-router when a route loader or a route element throws.
export function RouteErrorPage() {
  const error = useRouteError()
  console.error('[RouteError]', error)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
      <h1 className="display text-xl font-semibold">This page could not load</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Go back and try again. If it keeps happening, report it with what you were doing at
        the time.
      </p>
      <Button variant="outline" onClick={() => window.history.back()}>
        Go back
      </Button>
    </div>
  )
}
