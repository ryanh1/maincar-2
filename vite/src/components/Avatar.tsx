import { useState } from 'react'

import { cn } from '@/lib/utils'

export function Avatar({
  name,
  src,
  className,
  size = 'size-6',
}: {
  name: string
  src?: string | null
  className?: string
  size?: 'size-6' | 'size-16'
}) {
  return <AvatarImage key={src ?? 'fallback'} name={name} src={src} className={className} size={size} />
}

function AvatarImage({ name, src, className, size }: { name: string; src?: string | null; className?: string; size: 'size-6' | 'size-16' }) {
  const [failed, setFailed] = useState(false)
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?'

  if (src && !failed) {
    return <img src={src} alt="" className={cn(size, 'shrink-0 rounded-full border border-border object-cover', className)} onError={() => setFailed(true)} />
  }
  return <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground', size, className)}>{initials}</span>
}
