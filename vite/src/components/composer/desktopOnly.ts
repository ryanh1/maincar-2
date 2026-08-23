import { useSyncExternalStore } from 'react'

/**
 * The one place that says the composer is desktop-only, read by both halves of
 * it: the dock in the corner and the Compose button in the sidebar.
 *
 * The composer keeps its existing 1204 px desktop threshold. MAI-468 replaces
 * the old estimated action width with a 64 px rail and a shared 384 px
 * rail-plus-dialer reserve, but does not widen the desktop composer onto compact
 * layouts. Below this threshold, composing remains full-screen; at and above it,
 * one 320 px card plus its 12 px slot gap fits without touching the sidebar or
 * the outreach reserve.
 *
 * Measured in JavaScript rather than with a `hidden lg:flex` class, because
 * "renders nothing" is the promise being made — a control hidden by CSS is still
 * mounted, still wired, and still reachable by whatever the next screen size
 * does to it. The dock already reads `window.innerWidth` for its own layout
 * arithmetic, so this keeps one source of truth for the width instead of two.
 */
export const LG_BREAKPOINT_PX = 1204

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/**
 * The viewport width, read through `useSyncExternalStore` rather than a
 * `useState` seeded in an effect: the first paint gets the real width, so a card
 * never renders expanded for one frame and snaps to a chip on the next.
 */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribeToResize, () => window.innerWidth)
}

/**
 * Is the window wide enough for the composer at all?
 *
 * The snapshot is the boolean, not the width, so a drag across the desktop
 * re-renders the caller once — when the answer flips — and not on every pixel.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeToResize, () => window.innerWidth >= LG_BREAKPOINT_PX)
}
