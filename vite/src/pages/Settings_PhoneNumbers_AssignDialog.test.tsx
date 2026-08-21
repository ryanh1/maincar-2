// The assign/reassign dialog for one org phone number (MAI-197).
//
// What these protect:
//   - the title and body flip between "Assign" and "Reassign", naming the
//     current holder when there is one
//   - the submit button is disabled until a member is picked
//   - picking a member and submitting sends exactly that member's id
import { beforeEach, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useGetMembersMock, assignMutateMock } = vi.hoisted(() => ({
  useGetMembersMock: vi.fn(),
  assignMutateMock: vi.fn(),
}))

vi.mock('@/hooks/orgs', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/orgs/types')>('@/hooks/orgs/types')
  return { ...actual, useGetMembers: useGetMembersMock }
})
vi.mock('@/hooks/phoneNumbers', () => ({
  useAssignNumber: () => ({ mutate: assignMutateMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { Settings_PhoneNumbers_AssignDialog } from './Settings_PhoneNumbers_AssignDialog'

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

const MEMBERS = [
  { userId: 'user-b', email: 'b@acme.com', firstName: 'Bee', lastName: 'Ta' },
  { userId: 'user-c', email: 'c@acme.com', firstName: 'See', lastName: 'Gee' },
]

beforeEach(() => {
  vi.clearAllMocks()
  useGetMembersMock.mockReturnValue({ data: { members: MEMBERS }, isPending: false })
})

function render(number: typeof UNASSIGNED | typeof HELD) {
  renderWithProviders(
    <Settings_PhoneNumbers_AssignDialog orgId="org-a" number={number} open onOpenChange={vi.fn()} />,
  )
}

it('says "Assign" and that nobody holds the number yet, when it is unassigned', () => {
  render(UNASSIGNED)

  expect(screen.getByRole('heading', { name: /Assign \+12025550123/ })).toBeInTheDocument()
  expect(screen.getByText('Nobody holds this number yet.')).toBeInTheDocument()
})

it('says "Reassign" and names the current holder, when someone holds the number', () => {
  render(HELD)

  expect(screen.getByRole('heading', { name: /Reassign \+12025550123/ })).toBeInTheDocument()
  expect(screen.getByText(/Currently held by Bee Ta/)).toBeInTheDocument()
})

it('disables the submit button until a member is picked', () => {
  render(UNASSIGNED)

  expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
})

it('sends the picked member’s id on submit', async () => {
  const user = userEvent.setup()
  render(UNASSIGNED)

  await user.click(screen.getByRole('combobox', { name: 'Member' }))
  await user.click(await screen.findByRole('option', { name: 'See Gee' }))
  await user.click(screen.getByRole('button', { name: 'Assign' }))

  expect(assignMutateMock).toHaveBeenCalledWith(
    { orgId: 'org-a', id: 'num-1', userId: 'user-c' },
    expect.anything(),
  )
})

it('shows a loading skeleton in place of the picker while members load', () => {
  useGetMembersMock.mockReturnValue({ data: undefined, isPending: true })

  render(UNASSIGNED)

  expect(screen.queryByRole('combobox', { name: 'Member' })).not.toBeInTheDocument()
})
