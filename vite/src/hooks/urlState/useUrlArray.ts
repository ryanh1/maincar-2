import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A repeated query param as an array — a multi-select filter.
 *
 * `useMemo` keeps the array reference stable across renders that did not change
 * the param, so it is safe to drop straight into a React Query key.
 */
export function useUrlArray(key: string): [string[], (next: string[]) => void] {
  const [params, setParams] = useSearchParams()
  const value = useMemo(() => params.getAll(key), [params, key])

  const setValue = useCallback(
    (next: string[]) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev)
          updated.delete(key)
          for (const entry of next) updated.append(key, entry)
          return updated
        },
        { replace: true },
      )
    },
    [key, setParams],
  )

  return [value, setValue]
}
