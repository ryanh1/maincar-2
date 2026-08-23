import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, jsonFetchMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  jsonFetchMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>()
  return { ...actual, jsonFetch: jsonFetchMock }
})

import { NotificationCenter } from './NotificationCenter'

const notification = {
  id: 'notification-1',
  readAt: null,
  archivedAt: null,
  snoozedUntil: null,
  createdAt: '2026-08-22T16:00:00.000Z',
  source: {
    status: 'available' as const,
    type: 'call',
    title: 'Maya mentioned you',
    preview: 'Can you review the follow-up?',
    route: '/orgs/org-1/calls/call-1',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({
    org: { id: 'org-1', name: 'Acme' },
    user: { timeZone: 'America/New_York' },
  })
  jsonFetchMock.mockImplementation((url: string) => {
    if (url.includes('read=false')) return Promise.resolve({ notifications: [], total: 2, page: 1, limit: 1 })
    return Promise.resolve({ notifications: [notification], total: 1, page: 1, limit: 25 })
  })
})

describe('NotificationCenter', () => {
  it('announces the unread count and opens the inbox with an explicitly-zoned event time', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)

    const inboxTrigger = await screen.findByRole('button', { name: 'Inbox. 2 unread.' })
    expect(inboxTrigger).toHaveTextContent('Inbox')
    await user.click(inboxTrigger)

    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Inbox' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Maya mentioned you')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'System notification' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open call' })).toHaveAttribute('href', '/calls/call-1')
    expect(screen.getByText(/EDT$/)).toBeInTheDocument()
    expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications?read=false&limit=1')
  })

  it('shows a teammate avatar when the notification identifies its actor', async () => {
    jsonFetchMock.mockImplementation((url: string) => {
      if (url.includes('read=false')) return Promise.resolve({ notifications: [], total: 1, page: 1, limit: 1 })
      return Promise.resolve({
        notifications: [{ ...notification, actor: { name: 'Maya Chen', imageUrl: null } }],
        total: 1,
        page: 1,
        limit: 25,
      })
    })
    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Inbox. 1 unread.' }))

    expect(await screen.findByLabelText('Notification from Maya Chen')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'System notification' })).not.toBeInTheDocument()
  })

  it('sends a row lifecycle action and restores the row when the request fails', async () => {
    jsonFetchMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') return Promise.reject(new Error('Network unavailable'))
      if (url.includes('read=false')) return Promise.resolve({ notifications: [], total: 1, page: 1, limit: 1 })
      return Promise.resolve({ notifications: [notification], total: 1, page: 1, limit: 25 })
    })
    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Inbox. 1 unread.' }))

    await user.click(screen.getByRole('button', { name: 'Show actions for Maya mentioned you' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications/notification-1', {
      method: 'PATCH', body: JSON.stringify({ action: 'archive' }),
    })
    await waitFor(() => expect(screen.getByText('Maya mentioned you')).toBeInTheDocument())
  })

  it('links a note mention back to the record that owns the note', async () => {
    const noteMention = {
      ...notification,
      source: {
        status: 'available' as const,
        type: 'note',
        title: 'You were mentioned in a note',
        preview: 'Please review the account plan.',
        route: '/orgs/org-1/records/company?recordId=company-1',
      },
    }
    jsonFetchMock.mockImplementation((url: string) => {
      if (url.includes('read=false')) return Promise.resolve({ notifications: [], total: 1, page: 1, limit: 1 })
      return Promise.resolve({ notifications: [noteMention], total: 1, page: 1, limit: 25 })
    })

    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Inbox. 1 unread.' }))

    expect(await screen.findByRole('link', { name: 'Open record' })).toHaveAttribute(
      'href',
      '/records/company?recordId=company-1',
    )
  })

  it('switches to the archived view and applies a bulk action to selected rows', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Inbox. 2 unread.' }))

    await user.click(screen.getByRole('tab', { name: 'Archived' }))
    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications?view=archived&limit=25'))

    await user.click(screen.getByRole('tab', { name: 'Inbox' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Select Maya mentioned you' }))
    await user.click(screen.getByRole('button', { name: 'Bulk actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications/bulk', {
      method: 'POST', body: JSON.stringify({ action: 'archive', notificationIds: ['notification-1'] }),
    })
  })
})
