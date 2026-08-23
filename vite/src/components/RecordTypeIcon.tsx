import { Suspense, type ComponentProps, type CSSProperties } from 'react'
import { Database } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'

import { resolveOptionColor } from '@/lib/optionPalette'
import { normalizeRecordTypeIconName } from '@/components/recordTypeIcons'

type RecordTypeIconProps = Omit<ComponentProps<typeof Database>, 'color'> & {
  icon: string | null | undefined
  color?: string | null
}

function fallbackProps(props: Omit<RecordTypeIconProps, 'icon' | 'color'>, style: CSSProperties) {
  return { ...props, style, 'data-icon-name': 'database' }
}

/** Resolves one record type's configured Lucide icon and color with a safe fallback. */
export function RecordTypeIcon({ icon, color, size = 16, style, ...props }: RecordTypeIconProps) {
  const name = normalizeRecordTypeIconName(icon)
  const resolvedStyle = { ...style, color: resolveOptionColor(color?.trim() || undefined) }
  const sharedProps = { ...props, size, style: resolvedStyle }

  if (!name) return <Database {...fallbackProps(sharedProps, resolvedStyle)} />

  return (
    <Suspense fallback={<Database {...fallbackProps(sharedProps, resolvedStyle)} />}>
      <DynamicIcon
        {...sharedProps}
        name={name}
        data-icon-name={name}
        fallback={() => <Database {...fallbackProps(sharedProps, resolvedStyle)} />}
      />
    </Suspense>
  )
}
