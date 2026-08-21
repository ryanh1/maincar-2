import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useDeleteEmailTemplate } from '../useDeleteEmailTemplate'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderDeleteTemplate(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useDeleteEmailTemplate(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useDeleteEmailTemplate', () => {
  it('DELETEs the template path and hands back the id the server confirmed', async () => {
    jsonFetch.mockResolvedValue({ template: { id: 'tpl-1' } })

    const { result } = renderDeleteTemplate()
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/templates/tpl-1', {
      method: 'DELETE',
    })
    expect(result.current.data?.template.id).toBe('tpl-1')
  })

  it('invalidates the org templates list after a delete that worked', async () => {
    jsonFetch.mockResolvedValue({ template: { id: 'tpl-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderDeleteTemplate(client)
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // useDeleteEmailDraft deliberately does NOT invalidate here, because a
    // refetch would hand the composer provider server copies of cards still
    // being typed in. A template list has no such cost, and it is org-shared:
    // the refetch also picks up what teammates changed while this rep was in
    // Settings.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.email.templates('org-1') })
  })

  it('counts a 404 as the delete that was asked for, and says nothing about it', async () => {
    // Two reps really can confirm the same AlertDialog on the same org-shared
    // row. The second gets a 404 for a template that is gone, which is exactly
    // what they wanted — so this resolves rather than rejecting.
    jsonFetch.mockRejectedValue(new ApiError('Template not found', 404))

    const { result } = renderDeleteTemplate()
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.template.id).toBe('tpl-1')
  })

  it('still invalidates after a 404, because the list is holding a row the server does not have', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Template not found', 404))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderDeleteTemplate(client)
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.email.templates('org-1') })
  })

  it('invalidates on a real failure, to resync a list that now disagrees', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Something went wrong. Try again.', 500))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderDeleteTemplate(client)
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.email.templates('org-1') })
    expect((result.current.error as ApiError).message).toBe('Something went wrong. Try again.')
    expect((result.current.error as ApiError).status).toBe(500)
  })

  it('leaves the drafts cache alone — a deleted template never touches a draft made from it', async () => {
    jsonFetch.mockResolvedValue({ template: { id: 'tpl-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderDeleteTemplate(client)
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.email.drafts('org-1') })
  })
})
