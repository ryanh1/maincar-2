import googleLogo from '@/assets/google.jpeg'
import microsoftLogo from '@/assets/microsoft.jpeg'
import type { Provider } from '@/hooks/integrations'

/**
 * The provider's own brand logo, saved locally rather than fetched at runtime. This is
 * the one deliberate exception to the one-accent, no-brand-colour rule
 * (rules/design-system.md → Color): a third-party OAuth provider's mark identifies THEM,
 * not Maincar's own UI, so it is never recoloured to fit our palette.
 */
const LOGO: Record<Provider, string> = {
  google: googleLogo,
  microsoft: microsoftLogo,
}

export function Settings_Integrations_ProviderMark({
  provider,
  label,
}: {
  provider: Provider
  label: string
}) {
  return (
    <img
      src={LOGO[provider]}
      alt={`${label} logo`}
      className="size-8 shrink-0 rounded-md border border-border object-contain"
    />
  )
}
