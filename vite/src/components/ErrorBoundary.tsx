import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * The last line of defence. A render error anywhere below this shows a readable
 * page instead of a blank white screen.
 *
 * This must stay a class component — React has no hook equivalent of
 * `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
        <h1 className="display text-xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page could not be displayed. Reload to try again. If it keeps happening, report
          it with what you were doing at the time.
        </p>
        <Button onClick={() => window.location.reload()}>Reload the page</Button>
      </div>
    )
  }
}
