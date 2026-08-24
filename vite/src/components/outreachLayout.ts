import { createContext, useContext } from 'react'

/** The command bar switches from a bottom bar to the right rail at Tailwind's sm breakpoint. */
export const OUTREACH_RAIL_BREAKPOINT_PX = 640
/** A stable 64 px application column for desktop outreach actions. */
export const OUTREACH_RAIL_WIDTH_PX = 64
/** The expanded dialer card is Tailwind's w-80 (320 px). */
export const OUTREACH_DIALER_WIDTH_PX = 320
/** The mobile command bar is Tailwind's h-12 (48 px). */
export const OUTREACH_MOBILE_BAR_HEIGHT_PX = 48
/** Desktop composer cards are Tailwind's h-96 (384 px). */
export const OUTREACH_COMPOSER_HEIGHT_PX = 384
/** Composer cards always stop before the rail and a potentially expanded dialer. */
export const OUTREACH_COMPOSER_RIGHT_INSET_PX = OUTREACH_RAIL_WIDTH_PX + OUTREACH_DIALER_WIDTH_PX

export interface OutreachLayout {
  usesRail: boolean
  pageRightInsetPx: number
  pageBottomInsetPx: number
  dialerRightInsetPx: number
}

export function getOutreachLayout(
  windowWidth: number,
  dialerExpanded: boolean,
  composerVisible = false,
): OutreachLayout {
  const usesRail = windowWidth >= OUTREACH_RAIL_BREAKPOINT_PX
  if (!usesRail) {
    return {
      usesRail: false,
      pageRightInsetPx: 0,
      pageBottomInsetPx: OUTREACH_MOBILE_BAR_HEIGHT_PX,
      dialerRightInsetPx: 0,
    }
  }

  return {
    usesRail: true,
    pageRightInsetPx: OUTREACH_RAIL_WIDTH_PX + (dialerExpanded ? OUTREACH_DIALER_WIDTH_PX : 0),
    pageBottomInsetPx: composerVisible ? OUTREACH_COMPOSER_HEIGHT_PX : 0,
    dialerRightInsetPx: OUTREACH_RAIL_WIDTH_PX,
  }
}

export const OutreachLayoutContext = createContext<OutreachLayout>(getOutreachLayout(0, false))

export function useOutreachLayout(): OutreachLayout {
  return useContext(OutreachLayoutContext)
}
