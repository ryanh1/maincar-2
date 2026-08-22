/**
 * Monochrome initials tile for a member row.
 *
 * No color coding by role: roles read as text, and a rainbow of tints is exactly
 * what the design system rules out.
 */
export function Settings_Members_Avatar({
  name,
  email,
  avatarUrl,
}: {
  name: string | null
  email: string
  avatarUrl?: string | null
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        className="size-6 shrink-0 rounded-full border border-border object-cover"
      />
    )
  }

  const source = (name ?? email).trim()
  const initials = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

  return (
    <div
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground"
    >
      {initials || '?'}
    </div>
  )
}
