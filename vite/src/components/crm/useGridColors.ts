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
  changeHighlightTint: string
  changeHighlightDot: string
  /** Muted palette token name ("option-1") → resolved hex, for painted cells. */
  paintColors: Record<string, string>
  /** Muted palette token name ("option-1") → resolved faint tint hex, for relation-aware headers. */
  headerTintColors: Record<string, string>
}

const PAINT_TOKEN_NAMES = ['option-1', 'option-2', 'option-3', 'option-4', 'option-5', 'option-6', 'option-7', 'option-8']

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
  changeHighlightTint: '#eef2ff',
  changeHighlightDot: '#4f46e5',
  paintColors: {
    'option-1': '#0e7490',
    'option-2': '#0369a1',
    'option-3': '#4f46e5',
    'option-4': '#7e22ce',
    'option-5': '#be123c',
    'option-6': '#b45309',
    'option-7': '#0f766e',
    'option-8': '#475569',
  },
  headerTintColors: {
    'option-1': '#e0f2fe',
    'option-2': '#e0f2fe',
    'option-3': '#eef2ff',
    'option-4': '#f3e8ff',
    'option-5': '#ffe4e6',
    'option-6': '#fef3c7',
    'option-7': '#ccfbf1',
    'option-8': '#f1f5f9',
  },
}

function readGridColors(): GridColors {
  if (typeof window === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const paintColors: Record<string, string> = {}
  const headerTintColors: Record<string, string> = {}
  for (const token of PAINT_TOKEN_NAMES) {
    paintColors[token] = read(`--${token}`, FALLBACK.paintColors[token])
    headerTintColors[token] = read(`--${token}-tint`, FALLBACK.headerTintColors[token])
  }
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
    changeHighlightTint: read('--change-highlight-tint', FALLBACK.changeHighlightTint),
    changeHighlightDot: read('--change-highlight-dot', FALLBACK.changeHighlightDot),
    paintColors,
    headerTintColors,
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
