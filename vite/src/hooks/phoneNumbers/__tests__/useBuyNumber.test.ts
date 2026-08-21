import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PhoneNumber } from '@/lib/phoneNumberTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useBuyNumber } from '../useBuyNumber'

// Only the transport is mocked. The hook's job is the URL, the method, the body,
// and what it invalidates on success.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function searchingRow(id: string): PhoneNumber {
  return {
    id,
    e164: '+12025550123',
    twilioSid: null,
    status: 'searching',
    isActiveForOutbound: false,
    createdAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderBuyNumber(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useBuyNumber(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useBuyNumber', () => {
  it('POSTs the number to the org-scoped path, orgId in the path only', async () => {
    jsonFetch.mockResolvedValue({ number: searchingRow('pn-1') })

    const { result } = renderBuyNumber()
    result.current.mutate({ orgId: 'org-1', e164: '+12025550123' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/phone-numbers', {
      method: 'POST',
      body: JSON.stringify({ e164: '+12025550123' }),
    })
    // The purchase comes back as a searching row, ready for the UI to poll.
    expect(result.current.data?.number.status).toBe('searching')
  })

  it('invalidates the numbers list so the searching row shows up in it', async () => {
    jsonFetch.mockResolvedValue({ number: searchingRow('pn-1') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderBuyNumber(client)
    result.current.mutate({ orgId: 'org-1', e164: '+12025550123' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.phoneNumbers.list('org-1') })
  })

  it('surfaces the server own message when the number is already owned', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('Your organization already has this number. Pick a different one.', 409),
    )

    const { result } = renderBuyNumber()
    result.current.mutate({ orgId: 'org-1', e164: '+12025550123' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'Your organization already has this number. Pick a different one.',
    )
    expect((result.current.error as ApiError).status).toBe(409)
  })
})
