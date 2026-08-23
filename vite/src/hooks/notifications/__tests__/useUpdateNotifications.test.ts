import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetNotificationsResponse } from '@/lib/notificationTypes'
import { withProviders } from '@/test/utils'
import { useUpdateNotifications } from '../useUpdateNotifications'

vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>()
  return { ...actual, jsonFetch: vi.fn() }
})

const response: GetNotificationsResponse = {
  notifications: [{
    id: 'notification-1', readAt: null, archivedAt: null, snoozedUntil: null,
    createdAt: '2026-08-22T16:00:00.000Z',
    actor: null,
    source: { status: 'available', type: 'call', title: 'Mention', preview: null },
  }],
  total: 1, page: 1, limit: 25,
}

describe('useUpdateNotifications', () => {
  it('rolls an optimistic archive back when the API rejects it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
    client.setQueryData(queryKeys.notifications.list('org-1', { view: 'inbox', read: 'all', limit: 25 }), response)
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
    let rejectRequest: (error: Error) => void
    vi.mocked(jsonFetch).mockImplementationOnce(() => new Promise((_, reject) => { rejectRequest = reject }))
    const { result } = renderHook(() => useUpdateNotifications(), { wrapper })

    act(() => result.current.mutate({ orgId: 'org-1', notificationIds: ['notification-1'], action: 'archive' }))

    await waitFor(() => expect(client.getQueryData<GetNotificationsResponse>(queryKeys.notifications.list('org-1', { view: 'inbox', read: 'all', limit: 25 }))?.notifications).toEqual([]))
    rejectRequest!(new Error('Network unavailable'))

    await waitFor(() => expect(client.getQueryData<GetNotificationsResponse>(queryKeys.notifications.list('org-1', { view: 'inbox', read: 'all', limit: 25 }))?.notifications).toEqual(response.notifications))
  })
})
