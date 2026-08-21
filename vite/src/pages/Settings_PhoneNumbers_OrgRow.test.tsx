// One row of the admin org-wide phone number inventory (MAI-197).
//
// What these protect:
//   - "Take back" is disabled when nobody holds the number — there is nothing
//     to take back
//   - the menu wording flips between "Assign" and "Reassign" based on the holder
//   - confirming "Take back" sends assignedUserId: null, never a guess
import { beforeEach, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { assignMutateMock } = vi.hoisted(() => ({ assignMutateMock: vi.fn() }))

vi.mock('@/hooks/phoneNumbers', () => ({
  useAssignNumber: () => ({ mutate: assignMutateMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// The assign/reassign dialog has its own coverage
// (Settings_PhoneNumbers_AssignDialog.test.tsx) — stubbed here so this file
// stays about the row's menu and the unassign confirmation.
vi.mock('./Settings_PhoneNumbers_AssignDialog', () => ({
  Settings_PhoneNumbers_AssignDialog: () => null,
}))

import { Settings_PhoneNumbers_OrgRow } from './Settings_PhoneNumbers_OrgRow'

const UNASSIGNED = {
  id: 'num-1',
  e164: '+12025550123',
  twilioSid: null,
  status: 'active' as const,
  isActiveForOutbound: false,
  createdAt: '2026-03-01T00:00:00.000Z',
  assignedUser: null,
}

const HELD = {
  ...UNASSIGNED,
  assignedUser: { id: 'user-b', firstName: 'Bee', lastName: 'Ta', email: 'b@acme.com' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

async function openMenu(number: typeof UNASSIGNED | typeof HELD) {
  const user = userEvent.setup()
  renderWithProviders(
    <table>
      <tbody>
        <Settings_PhoneNumbers_OrgRow orgId="org-a" number={number} timeZone="America/New_York" />
      </tbody>
    </table>,
  )
  await user.click(screen.getByRole('button', { name: `Show actions for ${number.e164}` }))
  return user
}

it('offers "Assign to a member" and greys "Take back" when nobody holds the number', async () => {
  await openMenu(UNASSIGNED)

  expect(screen.getByRole('menuitem', { name: /Assign to a member/ })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: /Take back this number/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

it('offers "Reassign" and an enabled "Take back" once a member holds the number', async () => {
  await openMenu(HELD)

  expect(screen.getByRole('menuitem', { name: /Reassign to another member/ })).toBeInTheDocument()
  const takeBack = screen.getByRole('menuitem', { name: /Take back this number/ })
  expect(takeBack).not.toHaveAttribute('aria-disabled', 'true')
})

it('confirming "Take back" sends assignedUserId: null, naming the number and the org', async () => {
  const user = await openMenu(HELD)

  await user.click(screen.getByRole('menuitem', { name: /Take back this number/ }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Take back +12025550123?')).toBeInTheDocument()

  await user.click(within(dialog).getByRole('button', { name: 'Take back' }))

  expect(assignMutateMock).toHaveBeenCalledWith(
    { orgId: 'org-a', id: 'num-1', userId: null },
    expect.anything(),
  )
})

it('cancelling "Take back" sends nothing', async () => {
  const user = await openMenu(HELD)

  await user.click(screen.getByRole('menuitem', { name: /Take back this number/ }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

  expect(assignMutateMock).not.toHaveBeenCalled()
})
