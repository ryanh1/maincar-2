import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { jsonFetch } from '@/lib/api'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetActivity } from '../useGetActivity'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch: vi.fn() }
})

function renderGetActivity() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return renderHook(
    () => useGetActivity('org-1', { companyId: 'company-1' }, { sourceType: 'call', limit: 3 }),
    { wrapper },
  )
}

beforeEach(() => vi.mocked(jsonFetch).mockReset())

describe('useGetActivity', () => {
  it('reads the first three call entries for one company through the existing activity endpoint', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ activity: [], page: 1, limit: 3, hasMore: false })

    const { result } = renderGetActivity()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith(
      '/api/orgs/org-1/activity?companyId=company-1&sourceType=call&limit=3',
    )
  })
})
