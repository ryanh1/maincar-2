import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PhoneNumber } from '@/lib/phoneNumberTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useSetActiveNumber } from '../useSetActiveNumber'

// Only the transport is mocked. The hook's job is the URL, the method, the body
// (always isActiveForOutbound: true), and what it invalidates on success.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function activeRow(id: string): PhoneNumber {
  return {
    id,
    e164: '+12025550123',
    twilioSid: 'PN123',
    status: 'active',
    isActiveForOutbound: true,
    createdAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderSetActive(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useSetActiveNumber(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useSetActiveNumber', () => {
  it('PATCHes the id with isActiveForOutbound true, orgId and id in the path only', async () => {
    jsonFetch.mockResolvedValue({ number: activeRow('pn-1') })

    const { result } = renderSetActive()
    result.current.mutate({ orgId: 'org-1', id: 'pn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/phone-numbers/pn-1', {
      method: 'PATCH',
      body: JSON.stringify({ isActiveForOutbound: true }),
    })
    expect(result.current.data?.number.isActiveForOutbound).toBe(true)
  })

  it('invalidates the numbers list so the picker reflects the switch', async () => {
    jsonFetch.mockResolvedValue({ number: activeRow('pn-1') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderSetActive(client)
    result.current.mutate({ orgId: 'org-1', id: 'pn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.phoneNumbers.list('org-1') })
  })

  it('invalidates the organization list so the Primary column reflects the switch', async () => {
    jsonFetch.mockResolvedValue({ number: activeRow('pn-1') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderSetActive(client)
    result.current.mutate({ orgId: 'org-1', id: 'pn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.phoneNumbers.orgList('org-1') })
  })

  it('surfaces the server own message when the number is not ready', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError(
        'This number is not ready to call from yet — it is searching. Pick a number that is active.',
        400,
      ),
    )

    const { result } = renderSetActive()
    result.current.mutate({ orgId: 'org-1', id: 'pn-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).status).toBe(400)
  })
})
