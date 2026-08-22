import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useDeleteEmailSignature } from '../useDeleteEmailSignature'
import { useGetEmailSignatures } from '../useGetEmailSignatures'
import { useSaveEmailSignature } from '../useSaveEmailSignature'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function wrapper({ children }: { children: ReactNode }) {
  return withProviders(children)
}

beforeEach(() => jsonFetch.mockReset())

describe('email signature hooks', () => {
  it('reads a rep’s signatures from the active organization path', async () => {
    jsonFetch.mockResolvedValue({
      signatures: [{ id: 'sig-1', name: 'Work', bodyHtml: '<p>Ari</p>', isDefault: true }],
      total: 1,
    })

    const { result } = renderHook(() => useGetEmailSignatures('org-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/signatures')
    expect(result.current.data?.signatures[0].isDefault).toBe(true)
  })

  it('does not request signatures before the active organization is known', async () => {
    const { result } = renderHook(() => useGetEmailSignatures(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('creates, updates, and invalidates the shared signature list', async () => {
    jsonFetch.mockResolvedValue({
      signature: { id: 'sig-1', name: 'Work', bodyHtml: '<p>Ari</p>', isDefault: true },
    })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const clientWrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
    const { result } = renderHook(() => useSaveEmailSignature(), { wrapper: clientWrapper })

    result.current.mutate({ orgId: 'org-1', name: 'Work', bodyHtml: '<p>Ari</p>', isDefault: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/signatures', {
      method: 'POST',
      body: JSON.stringify({ name: 'Work', bodyHtml: '<p>Ari</p>', isDefault: true }),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.email.signatures('org-1') })
  })

  it('deletes a signature and invalidates the picker list', async () => {
    jsonFetch.mockResolvedValue({ signature: { id: 'sig-1' } })
    const { result } = renderHook(() => useDeleteEmailSignature(), { wrapper })

    result.current.mutate({ orgId: 'org-1', signatureId: 'sig-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/signatures/sig-1', { method: 'DELETE' })
  })
})
