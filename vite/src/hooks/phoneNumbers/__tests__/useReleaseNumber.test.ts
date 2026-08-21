import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PhoneNumber } from '@/lib/phoneNumberTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useReleaseNumber } from '../useReleaseNumber'

// Only the transport is mocked. The hook's job is the URL, the method, and what
// it invalidates on success — the release itself is a server-side job.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function releasingRow(id: string): PhoneNumber {
  return {
    id,
    e164: '+12025550123',
    twilioSid: 'PN123',
    status: 'releasing',
    isActiveForOutbound: false,
    createdAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderRelease(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useReleaseNumber(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useReleaseNumber', () => {
  it('DELETEs the number, orgId and id in the path only, no body', async () => {
    jsonFetch.mockResolvedValue({ number: releasingRow('pn-1') })

    const { result } = renderRelease()
    result.current.mutate({ orgId: 'org-1', id: 'pn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/phone-numbers/pn-1', {
      method: 'DELETE',
    })
    expect(result.current.data?.number.status).toBe('releasing')
  })

  it('invalidates the numbers list so the row shows as releasing', async () => {
    jsonFetch.mockResolvedValue({ number: releasingRow('pn-1') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderRelease(client)
    result.current.mutate({ orgId: 'org-1', id: 'pn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.phoneNumbers.list('org-1') })
  })

  it('surfaces the server’s own refusal message', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('Make a different number your caller ID first, then release this one.', 409),
    )

    const { result } = renderRelease()
    result.current.mutate({ orgId: 'org-1', id: 'pn-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).status).toBe(409)
    expect((result.current.error as ApiError).message).toBe(
      'Make a different number your caller ID first, then release this one.',
    )
  })
})
