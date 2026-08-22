import { useEffect, useState } from 'react'

interface GridColors {
  background: string
  border: string
  headerBg: string
  headerText: string
  cellText: string
  mutedText: string
  accent: string
  activeCallAccent: string
  activeCallTint: string
  recentCallTint: string
}

const FALLBACK: GridColors = {
  background: '#ffffff',
  border: '#e2e8f0',
  headerBg: '#f1f5f9',
  headerText: '#64748b',
  cellText: '#0f172a',
  mutedText: '#64748b',
  accent: '#4f46e5',
  activeCallAccent: '#0284c7',
  activeCallTint: '#e0f2fe',
  recentCallTint: '#f0f9ff',
}

function readGridColors(): GridColors {
  if (typeof window === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    background: read('--background', FALLBACK.background),
    border: read('--border', FALLBACK.border),
    headerBg: read('--muted', FALLBACK.headerBg),
    headerText: read('--muted-foreground', FALLBACK.headerText),
    cellText: read('--foreground', FALLBACK.cellText),
    mutedText: read('--muted-foreground', FALLBACK.mutedText),
    accent: read('--primary', FALLBACK.accent),
    activeCallAccent: read('--status-active', FALLBACK.activeCallAccent),
    activeCallTint: read('--status-active-tint', FALLBACK.activeCallTint),
    recentCallTint: read('--status-active-faded-tint', FALLBACK.recentCallTint),
  }
}

/**
 * Resolved token colors for the canvas grid. Canvas drawing can't read a CSS
 * custom property directly — `ctx.fillStyle = "var(--border)"` is not a valid
 * color — so this reads the computed values instead, and re-reads them
 * whenever the `dark` class flips on `<html>`, which is how the rest of the
 * app switches theme.
 */
export function useGridColors(): GridColors {
  const [colors, setColors] = useState(readGridColors)

  useEffect(() => {
    const update = () => setColors(readGridColors())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return colors
}
