import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

type ParamValue = string | number | string[] | null

/**
 * Change several query params in ONE navigation.
 *
 * react-router's functional `setSearchParams(prev => …)` reads the params of the
 * CURRENT render, so calling two of the single-key setters in one handler makes
 * the second silently clobber the first — sorting by a new column and resetting
 * the page would lose the column. Anything that changes more than one param at a
 * time goes through here instead.
 *
 * `null`, `''`, and an empty array delete the key. Writes replace the history
 * entry, so Back is not spammed by filter tweaks.
 */
export function useSetUrlParams(): (updates: Record<string, ParamValue>) => void {
  const [, setParams] = useSearchParams()

  return useCallback(
    (updates: Record<string, ParamValue>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(updates)) {
            next.delete(key)
            if (value === null || value === '') continue
            if (Array.isArray(value)) {
              for (const entry of value) next.append(key, entry)
            } else {
              next.set(key, String(value))
            }
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
}
