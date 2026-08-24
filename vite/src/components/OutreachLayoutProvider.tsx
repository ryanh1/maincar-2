import { useMemo, type ReactNode } from 'react'

import { LG_BREAKPOINT_PX, useWindowWidth } from '@/components/composer/desktopOnly'
import { useComposer } from '@/components/composer/composerContext'
import { useDialer } from '@/components/dialer/dialerContext'
import { getOutreachLayout, OutreachLayoutContext } from '@/components/outreachLayout'

export function OutreachLayoutProvider({ children }: { children: ReactNode }) {
  const windowWidth = useWindowWidth()
  const { view } = useDialer()
  const { openDrafts } = useComposer()
  const layout = useMemo(
    () => getOutreachLayout(
      windowWidth,
      view === 'expanded',
      windowWidth >= LG_BREAKPOINT_PX && openDrafts.length > 0,
    ),
    [openDrafts.length, view, windowWidth],
  )

  return <OutreachLayoutContext.Provider value={layout}>{children}</OutreachLayoutContext.Provider>
}
