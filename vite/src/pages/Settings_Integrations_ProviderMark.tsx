import type { Provider } from '@/hooks/integrations'

/**
 * The provider glyph on a card: a monochrome monogram tile, one letter per provider.
 *
 * Deliberately NOT the brand's own multi-colour logo. The design system allows one
 * accent and rules out a rainbow of tints (rules/design-system.md → Color), and
 * Google's four-colour "G" and Microsoft's four-square mark are exactly that. A neutral
 * tile matches `Settings_Members_Avatar` and stays inside the system. The provider's
 * name still reads in words beside it, so the glyph is decoration, not the label.
 */
const MONOGRAM: Record<Provider, string> = {
  google: 'G',
  microsoft: 'M',
}

export function Settings_Integrations_ProviderMark({ provider }: { provider: Provider }) {
  return (
    <div
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold text-muted-foreground"
    >
      {MONOGRAM[provider] ?? '?'}
    </div>
  )
}
