import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A string that lives in the query string.
 *
 * Table search, sort, filter, and page all belong here rather than in component
 * state: a reload, a Back, or a pasted link then restores the same view instead
 * of dropping the reader back on an unfiltered page one.
 *
 * Writes REPLACE the history entry, so Back is not spammed with one entry per
 * keystroke.
 */
export function useUrlString(
  key: string,
  defaultValue = '',
): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? defaultValue

  const setValue = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev)
          // The default is what an absent key already means, so writing it would
          // only make the URL longer.
          if (!next || next === defaultValue) updated.delete(key)
          else updated.set(key, next)
          return updated
        },
        { replace: true },
      )
    },
    [key, defaultValue, setParams],
  )

  return [value, setValue]
}
