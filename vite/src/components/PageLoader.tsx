import { Loader2 } from 'lucide-react'

export function PageLoader() {
  return (
    <div className="flex flex-1 items-center justify-center p-12">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  )
}
