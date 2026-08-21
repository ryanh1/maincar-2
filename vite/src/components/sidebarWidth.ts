/**
 * The sidebar's width, **224 px** = Tailwind's `w-56` (56 steps × 4 px) on the
 * `<aside>` in `Sidebar.tsx`, matched by `lg:ml-56` on the main column in
 * `ProtectedLayout.tsx`.
 *
 * Anything `fixed` to the window has to subtract this by hand. The sidebar is
 * `fixed inset-y-0 left-0` and translated on screen from `lg` up, so it covers
 * the left 224 px of every viewport the composer dock renders at, and a dock
 * that measured `window.innerWidth` alone would lay its leftmost card straight
 * over it. `<main>`'s `lg:ml-56` protects the page, not the fixed chrome.
 *
 * Named here rather than exported from `Sidebar.tsx` because a module that
 * exports both a component and a plain value breaks fast refresh and trips
 * `eslint-plugin-react-refresh` — the same reason `composer/draftTitle.ts` sits
 * beside the card that uses it.
 *
 * `sidebarWidth.test.ts` reads both source files and fails if either class ever
 * drifts from this number.
 */
export const SIDEBAR_WIDTH_PX = 224
