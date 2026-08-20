/**
 * Loaded before every test file (see vitest.config.ts `setupFiles`).
 *
 * It adds the jest-dom matchers and polyfills the browser APIs jsdom lacks but
 * Radix primitives call. Without these, opening a Select or a DropdownMenu in a
 * test throws inside the library, which reads like a bug in the component.
 */
import '@testing-library/jest-dom/vitest'

// Radix's popper-based components (Tooltip, Select, Popover) measure content
// with ResizeObserver, which jsdom does not implement.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// Pointer Capture and scrollIntoView are called by the Radix menu primitives when
// they open. jsdom has neither.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

// jsdom has no matchMedia; anything responsive that asks for it would throw.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
