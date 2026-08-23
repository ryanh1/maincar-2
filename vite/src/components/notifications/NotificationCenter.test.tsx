import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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
  summary: 'Maya mentioned you',
  bundleSize: 1,
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

  it('renders one card with the server aggregated sentence for a folded bundle', async () => {
    jsonFetchMock.mockImplementation((url: string) => {
      if (url.includes('read=false')) return Promise.resolve({ notifications: [], total: 1, page: 1, limit: 1 })
      return Promise.resolve({
        notifications: [{ ...notification, summary: 'Ana and 2 others commented on the Acme deal', bundleSize: 3 }],
        total: 1,
        page: 1,
        limit: 25,
      })
    })
    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Inbox. 1 unread.' }))

    expect(await screen.findByText('Ana and 2 others commented on the Acme deal')).toBeInTheDocument()
    expect(screen.queryByText('Maya mentioned you')).not.toBeInTheDocument()
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

  it('offers reminder durations instead of a fixed one-day snooze', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Inbox. 2 unread.' }))

    await user.click(screen.getByRole('button', { name: 'Show actions for Maya mentioned you' }))

    expect(await screen.findByRole('menuitem', { name: 'In one hour' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Next week' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Snooze for one day' })).not.toBeInTheDocument()

    const beforeSnooze = Date.now()
    await user.click(screen.getByRole('menuitem', { name: 'Tomorrow' }))
    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith(
      '/api/orgs/org-1/notifications/notification-1',
      expect.objectContaining({ method: 'PATCH' }),
    ))
    const [, options] = jsonFetchMock.mock.calls.find(([url]: [string]) => url.endsWith('/notification-1'))!
    const body = JSON.parse(options.body)
    expect(body.action).toBe('snooze')
    expect(new Date(body.snoozedUntil).getTime() - beforeSnooze).toBeGreaterThanOrEqual(86_399_000)
    expect(new Date(body.snoozedUntil).getTime() - beforeSnooze).toBeLessThanOrEqual(86_401_000)
  })

  it('triages a focused inbox row with u, e, and h without handling shortcuts outside the drawer or while typing', async () => {
    const focusedNotification = { ...notification, id: 'notification-2', readAt: '2026-08-22T17:00:00.000Z' }
    jsonFetchMock.mockImplementation((url: string) => {
      if (url.includes('read=false')) return Promise.resolve({ notifications: [], total: 2, page: 1, limit: 1 })
      return Promise.resolve({ notifications: [notification, focusedNotification], total: 2, page: 1, limit: 25 })
    })
    const user = userEvent.setup()
    renderWithProviders(<><input aria-label="Outside the inbox" /><NotificationCenter /></>)

    fireEvent.keyDown(document, { key: 'e' })
    expect(jsonFetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/notifications/notification-1'),
      expect.objectContaining({ method: 'PATCH' }),
    )

    await user.click(await screen.findByRole('button', { name: 'Inbox. 2 unread.' }))
    const [unreadRow] = await screen.findAllByRole('listitem')

    fireEvent.click(unreadRow)
    fireEvent.keyDown(document, { key: 'u' })
    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications/notification-1', {
      method: 'PATCH', body: JSON.stringify({ action: 'read' }),
    }))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'e' })
    expect(jsonFetchMock).not.toHaveBeenCalledWith('/api/orgs/org-1/notifications/notification-1', {
      method: 'PATCH', body: JSON.stringify({ action: 'archive' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Inbox. 2 unread.' }))
    fireEvent.keyDown(document, { key: 'e' })
    expect(jsonFetchMock).not.toHaveBeenCalledWith('/api/orgs/org-1/notifications/notification-1', {
      method: 'PATCH', body: JSON.stringify({ action: 'archive' }),
    })

    const [reopenedUnreadRow, reopenedReadRow] = await screen.findAllByRole('listitem')

    fireEvent.click(reopenedReadRow)
    fireEvent.keyDown(document, { key: 'u' })
    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications/notification-2', {
      method: 'PATCH', body: JSON.stringify({ action: 'unread' }),
    }))

    fireEvent.keyDown(screen.getByLabelText('Outside the inbox'), { key: 'e' })
    expect(jsonFetchMock).not.toHaveBeenCalledWith('/api/orgs/org-1/notifications/notification-2', {
      method: 'PATCH', body: JSON.stringify({ action: 'archive' }),
    })

    fireEvent.click(reopenedUnreadRow)
    fireEvent.keyDown(document, { key: 'e' })
    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications/notification-1', {
      method: 'PATCH', body: JSON.stringify({ action: 'archive' }),
    }))

    fireEvent.click(reopenedReadRow)
    fireEvent.keyDown(document, { key: 'h' })
    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith(
      '/api/orgs/org-1/notifications/notification-2',
      expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"action":"snooze"') }),
    ))
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

  it('uses Unread as a tab and sends type and object filters to the inbox API', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Inbox. 2 unread.' }))

    await user.click(screen.getByRole('tab', { name: 'Unread' }))
    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications?read=false&limit=25'))

    await user.click(screen.getByLabelText('Filter notifications by type'))
    await user.click(await screen.findByRole('option', { name: 'Mention' }))
    await user.click(screen.getByLabelText('Filter notifications by object'))
    await user.click(await screen.findByRole('option', { name: 'Companies' }))

    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalledWith('/api/orgs/org-1/notifications?read=false&type=mentioned&objectType=company&limit=25'))
  })
})
