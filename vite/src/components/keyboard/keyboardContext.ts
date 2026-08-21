import { createContext, useContext } from 'react'

interface KeyboardSystemContextValue {
  openPalette: () => void
  openShortcuts: () => void
}

export const KeyboardSystemContext = createContext<KeyboardSystemContextValue | null>(null)

/** Lets navigation chrome open the same keyboard surfaces it advertises. */
export function useKeyboardSystemOptional() {
  return useContext(KeyboardSystemContext)
}
