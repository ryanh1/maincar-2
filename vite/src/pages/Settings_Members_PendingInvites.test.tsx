// How a pending invite's expiry reads.
//
// What these protect:
//   - the expiry is a DATE: no time of day, no zone label
//   - the date shown is the one the INVITER set, so it does not slide by a day
//     for an admin reading the list from another zone
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useGetInvitationsMock } = vi.hoisted(() => ({ useGetInvitationsMock: vi.fn() }))

vi.mock('@/hooks/orgs', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/orgs/types')>('@/hooks/orgs/types')
  return {
    ...actual,
    useGetInvitations: useGetInvitationsMock,
    useRevokeInvitation: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRegenerateInvitation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { Settings_Members_PendingInvites } from './Settings_Members_PendingInvites'

/** The last millisecond of Sep 4 in New York — where an invite created there dies. */
const INVITATION = {
  id: 'inv-1',
  email: 'new@acme.com',
  roles: ['basic'],
  status: 'PENDING',
  expiresAt: '2026-09-05T03:59:59.999Z',
  expiresAtTimeZone: 'America/New_York',
  inviteUrl: 'http://localhost:5183/join/tok-1',
  createdAt: '',
}

function render(invitation: Record<string, unknown> = INVITATION) {
  useGetInvitationsMock.mockReturnValue({ data: [invitation], isPending: false, isError: false })
  renderWithProviders(
    <Settings_Members_PendingInvites orgId="org-a" enabled timeZone="America/New_York" />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the expiry on a pending invite', () => {
  it('shows a date, with no time of day and no zone label', () => {
    render()

    expect(screen.getByText(/expires Sep 4, 2026$/)).toBeInTheDocument()
    expect(screen.queryByText(/11:59/)).not.toBeInTheDocument()
    expect(screen.queryByText(/EDT|EST|UTC/)).not.toBeInTheDocument()
  })

  // Same instant, same New York reader — only the inviter's zone changes, and the
  // date follows it. That instant is already Sep 5 in Tokyo, so an invite cut
  // there reads Sep 5 to everyone, which is the date its inviter chose.
  it("follows the inviter's zone, not the reader's", () => {
    render({ ...INVITATION, expiresAtTimeZone: 'Asia/Tokyo' })

    expect(screen.getByText(/expires Sep 5, 2026$/)).toBeInTheDocument()
  })
})

// The complaint that produced the tooltip rule was aimed at this exact button:
// "I don't know what the refresh button does." A circular arrow beside an email
// address reads as "reload" and is not — it mints a link and kills the old one.
describe('the icon buttons on a pending invite', () => {
  it('says what the circular arrow does, in words, on hover and to a screen reader', async () => {
    const user = userEvent.setup()
    render()

    const regenerate = screen.getByRole('button', {
      name: 'Create a new invite link for new@acme.com and cancel the old one',
    })

    await user.hover(regenerate)
    expect(
      (
        await screen.findAllByText(
          'Create a new invite link for new@acme.com and cancel the old one',
        )
      ).length,
    ).toBeGreaterThan(0)
  })

  it('names the invite the bin empties, not just "Delete"', async () => {
    const user = userEvent.setup()
    render()

    const revoke = screen.getByRole('button', { name: 'Revoke the invite for new@acme.com' })

    await user.hover(revoke)
    expect((await screen.findAllByText('Revoke the invite for new@acme.com')).length).toBeGreaterThan(
      0,
    )
  })
})
