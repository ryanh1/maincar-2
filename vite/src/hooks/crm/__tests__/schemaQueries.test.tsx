import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetAttributeImpact } from '../useGetAttributeImpact'
import { useGetFieldHistory } from '../useGetFieldHistory'
import { useGetObjectImpact } from '../useGetObjectImpact'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ jsonFetch }))

function setup<T>(hook: () => T) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(hook, { wrapper }) }
}

describe('schema queries', () => {
  beforeEach(() => jsonFetch.mockReset())

  it('paginates one field history under its central query key', async () => {
    jsonFetch
      .mockResolvedValueOnce({ history: [{ id: 'history-2' }], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ history: [{ id: 'history-1' }], nextCursor: null })
    const { client, result } = setup(() => useGetFieldHistory('org-1', 'record-1', 'deal_stage'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenNthCalledWith(
      1,
      '/api/orgs/org-1/field-history?recordId=record-1&attribute=deal_stage',
    )
    expect(client.getQueryData(queryKeys.fieldHistory('org-1', 'record-1', 'deal_stage'))).toBeDefined()

    await result.current.fetchNextPage()
    expect(jsonFetch).toHaveBeenNthCalledWith(
      2,
      '/api/orgs/org-1/field-history?recordId=record-1&attribute=deal_stage&cursor=cursor-2',
    )
  })

  it('reads object delete impact under its central query key', async () => {
    const response = {
      recordCount: 12,
      references: [{ objectName: 'People', fieldName: 'Company', count: 4 }],
    }
    jsonFetch.mockResolvedValue(response)
    const { client, result } = setup(() => useGetObjectImpact('org-1', 'obj-company'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/obj-company/impact')
    expect(client.getQueryData(queryKeys.objectImpact('org-1', 'obj-company'))).toEqual(response)
  })

  it('reads field delete impact under its central query key', async () => {
    const response = { valueCount: 27 }
    jsonFetch.mockResolvedValue(response)
    const { client, result } = setup(() => useGetAttributeImpact('org-1', 'attr-domain'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/attributes/attr-domain/impact')
    expect(client.getQueryData(queryKeys.attributeImpact('org-1', 'attr-domain'))).toEqual(response)
  })

  it('does not read schema detail without the required identifiers', () => {
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children)
    const history = renderHook(() => useGetFieldHistory(null, null, null), { wrapper })
    const objectImpact = renderHook(() => useGetObjectImpact(null, null), { wrapper })
    const attributeImpact = renderHook(() => useGetAttributeImpact(null, null), { wrapper })

    expect(history.result.current.fetchStatus).toBe('idle')
    expect(objectImpact.result.current.fetchStatus).toBe('idle')
    expect(attributeImpact.result.current.fetchStatus).toBe('idle')
    expect(jsonFetch).not.toHaveBeenCalled()
  })
})
