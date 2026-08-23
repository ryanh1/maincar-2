/**
 * The muted option palette (design-system.md → Color → "Category and option
 * colors come from --option-1…8"). Select/status options store the token NAME,
 * never a hex, so a swatch edit recolours every chip/board column and the same
 * choice stays legible in dark mode (journey 4b.5.1, SPEC-CHUNK-2 J2.5 §A).
 */

export const OPTION_TOKENS = [
  'option-1',
  'option-2',
  'option-3',
  'option-4',
  'option-5',
  'option-6',
  'option-7',
  'option-8',
] as const

export type OptionToken = (typeof OPTION_TOKENS)[number]

export function isOptionToken(value: string): value is OptionToken {
  return (OPTION_TOKENS as readonly string[]).includes(value)
}

/**
 * Auto-assign the next unused token when an option is added (journey 4b.5.1).
 * Cycles back to option-1 when all eight are already taken.
 */
export function nextOptionToken(existing: readonly { color?: string }[]): OptionToken {
  const used = new Set(
    existing
      .map((option) => option.color)
      .filter((color): color is OptionToken => typeof color === 'string' && isOptionToken(color)),
  )
  for (const token of OPTION_TOKENS) {
    if (!used.has(token)) return token
  }
  return OPTION_TOKENS[0]
}

/**
 * Resolve a stored color to a CSS color for DOM rendering. A token name becomes
 * `var(--option-N)` so it follows the active theme; a legacy hex passes through.
 */
export function resolveOptionColor(color?: string): string {
  if (color && isOptionToken(color)) return `var(--${color})`
  return color ?? 'var(--muted-foreground)'
}

// The light-mode hex for each token, for canvas drawing (which cannot read a CSS
// custom property). Mirrors the `:root` values in index.css and the FALLBACK map
// in components/crm/useGridColors.ts. Callers that have a theme-aware token→hex
// map (useGridColors) should prefer it over this static fallback.
export const OPTION_TOKEN_HEX: Record<OptionToken, string> = {
  'option-1': '#0e7490',
  'option-2': '#0369a1',
  'option-3': '#4f46e5',
  'option-4': '#7e22ce',
  'option-5': '#be123c',
  'option-6': '#b45309',
  'option-7': '#0f766e',
  'option-8': '#475569',
}

/**
 * Resolve a stored color to a hex for canvas drawing. A token name resolves
 * through the theme-aware `paintColors` map when provided (so dark mode stays
 * correct), falling back to the static light-mode hex; a legacy hex passes
 * through unchanged.
 */
export function resolveOptionColorHex(
  color: string | undefined,
  paintColors?: Record<string, string>,
): string | undefined {
  if (color && isOptionToken(color)) {
    return paintColors?.[color] ?? OPTION_TOKEN_HEX[color]
  }
  return color
}
