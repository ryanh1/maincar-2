import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  getWorkspaceUrlState,
  setWorkspaceUrlState,
  type WorkspaceUrlState,
} from '@/lib/workspaceUrlState'

/**
 * React's one adapter for the workspace URL-state codec. Feature code can only
 * read or write the allow-listed state declared in workspaceUrlState.ts.
 */
export function useWorkspaceUrlState(): [
  WorkspaceUrlState,
  (update: (current: WorkspaceUrlState) => WorkspaceUrlState, options?: { replace?: boolean }) => void,
] {
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => getWorkspaceUrlState(params), [params])

  const updateState = useCallback(
    (update: (current: WorkspaceUrlState) => WorkspaceUrlState, options?: { replace?: boolean }) => {
      setParams((current) => setWorkspaceUrlState(current, update(getWorkspaceUrlState(current))), options)
    },
    [setParams],
  )

  return [state, updateState]
}
