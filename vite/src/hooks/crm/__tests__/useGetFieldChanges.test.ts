import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { queryKeys } from '@/lib/queryKeys'
import { useGetFieldChanges } from '../useGetFieldChanges'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ jsonFetch }))

function renderChanges(days = 7) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetFieldChanges('org-1', 'object-1', days), { wrapper }) }
}

describe('useGetFieldChanges', () => {
  beforeEach(() => jsonFetch.mockReset())

  it('reads the selected window through the object-scoped endpoint and central query key', async () => {
    jsonFetch.mockResolvedValue({ changes: [{ recordId: 'record-1', attributeId: 'status', changeCount: 3, previousValue: 'Open', currentValue: 'Won', changedAt: '2026-08-22T12:00:00.000Z' }] })

    const { client, result } = renderChanges(30)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/object-1/field-changes?days=30')
    expect(client.getQueryData(queryKeys.records.fieldChanges('org-1', 'object-1', 30))).toEqual(result.current.data)
  })

  it('does not request changes until both organization and object are available', () => {
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children)
    const { result } = renderHook(() => useGetFieldChanges(null, null, 7), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(jsonFetch).not.toHaveBeenCalled()
  })
})
