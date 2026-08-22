import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetVoicemails } from '../useGetVoicemails'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderGetVoicemails(orgId: string | null, params = {}) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return renderHook(() => useGetVoicemails(orgId, params), { wrapper })
}

beforeEach(() => jsonFetch.mockReset())

describe('useGetVoicemails', () => {
  it('fetches the org-scoped inbox with its pagination and caller search', async () => {
    jsonFetch.mockResolvedValue({ voicemails: [], total: 0, page: 2, limit: 10 })
    const { result } = renderGetVoicemails('org-1', { page: 2, limit: 10, q: '201' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/voicemails?page=2&limit=10&q=201')
  })

  it('waits for an organization before fetching', async () => {
    const { result } = renderGetVoicemails(null)

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })
})
