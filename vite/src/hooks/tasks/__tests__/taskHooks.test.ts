import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetTasks, useUpdateTask } from '..'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function wrapper(client: QueryClient = makeTestQueryClient()) {
  return ({ children }: { children: ReactNode }) => withProviders(children, { client })
}

describe('task hooks', () => {
  it('reads the current organization’s open tasks through its centralized query key', async () => {
    jsonFetch.mockResolvedValue({ tasks: [], total: 0, page: 1, limit: 100 })
    const client = makeTestQueryClient()
    const { result } = renderHook(() => useGetTasks('org-1', { isDone: false }), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/tasks?limit=100&isDone=false')
    expect(client.getQueryData(queryKeys.tasks.list('org-1', { isDone: false }))).toEqual({ tasks: [], total: 0, page: 1, limit: 100 })
  })

  it('PATCHes one task and refreshes task lists', async () => {
    jsonFetch.mockResolvedValue({ task: { id: 'task-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateTask(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ orgId: 'org-1', taskId: 'task-1', update: { priority: 'high' } })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/tasks/task-1', {
      method: 'PATCH', body: JSON.stringify({ priority: 'high' }),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks.all('org-1') })
  })
})
