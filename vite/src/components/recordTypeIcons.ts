import { dynamicIconImports } from 'lucide-react/dynamic'
import type { IconName } from 'lucide-react/dynamic'

/** Normalizes API and seeded icon names to Lucide's kebab-case registry keys. */
export function normalizeRecordTypeIconName(icon: string | null | undefined): IconName | null {
  if (!icon?.trim()) return null
  const normalized = icon
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .replace(/(\d)([a-zA-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()

  return normalized in dynamicIconImports ? normalized as IconName : null
}
