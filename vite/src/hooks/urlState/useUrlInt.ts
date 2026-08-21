import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** An integer in the query string — page numbers. A junk value reads as the default. */
export function useUrlInt(key: string, defaultValue = 1): [number, (next: number) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const parsed = raw ? parseInt(raw, 10) : NaN
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue

  const setValue = useCallback(
    (next: number) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev)
          if (next === defaultValue) updated.delete(key)
          else updated.set(key, String(next))
          return updated
        },
        { replace: true },
      )
    },
    [key, defaultValue, setParams],
  )

  return [value, setValue]
}
