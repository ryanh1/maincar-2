import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetObject } from '../useGetObject'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderGetObject(orgId: string | null | undefined, objectId: string | null | undefined) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetObject(orgId, objectId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetObject', () => {
  it('reads one object with its attributes', async () => {
    jsonFetch.mockResolvedValue({ object: { id: 'obj-1', slug: 'person', attributes: [] } })

    const { result } = renderGetObject('org-1', 'obj-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/obj-1')
  })

  it('does not fire without an org or an object id', async () => {
    const { result } = renderGetObject('org-1', null)

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under org AND object id, so switching objects reads a fresh entry', async () => {
    jsonFetch.mockResolvedValue({ object: { id: 'obj-1', attributes: [] } })

    const { client, result } = renderGetObject('org-1', 'obj-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.objects.detail('org-1', 'obj-1'))).toBeDefined()
  })
})
