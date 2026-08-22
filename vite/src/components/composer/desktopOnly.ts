import { useSyncExternalStore } from 'react'

/**
 * The one place that says the composer is desktop-only, read by both halves of
 * it: the dock in the corner and the Compose button in the sidebar.
 *
 * The sidebar takes 224 px on the left, the dock reserves 368 px for the
 * dialer on the right, the standing rail (the "Compose email" and "Drafts"
 * buttons — MAI-209) an estimated 280 px, and the card itself is 320 px —
 * 1192 px spoken for before anything else, rounded up to 1204 so the card's
 * own 320 px slot (plus its 12 px gap) always has exactly the room it needs.
 * Below this there is no corner left to put a card in, so — rather than
 * shrink one onto a phone — the dock renders nothing there
 * (SPEC-composer-dock.md → Open questions).
 *
 * This is no longer Tailwind's own `lg` (1024 px); it moved when MAI-209
 * widened the rail from one icon button to two labeled ones. Nothing outside
 * `ComposerDock.tsx` reads this threshold today (`useIsDesktop` below is
 * unused so far), so nothing else needed to move with it.
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
