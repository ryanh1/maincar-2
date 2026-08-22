import { beforeEach, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { setActiveMutateMock } = vi.hoisted(() => ({ setActiveMutateMock: vi.fn() }))

vi.mock('@/hooks/phoneNumbers', () => ({
  useSetActiveNumber: () => ({ mutate: setActiveMutateMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { Settings_PhoneNumbers_PrimaryControl } from './Settings_PhoneNumbers_PrimaryControl'

const NUMBER = {
  id: 'num-1',
  e164: '+12025550123',
  twilioSid: 'PN1',
  status: 'active' as const,
  isActiveForOutbound: false,
  createdAt: '2026-08-01T12:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('marks the existing primary number with a checkmark and label', () => {
  renderWithProviders(
    <Settings_PhoneNumbers_PrimaryControl
      number={{ ...NUMBER, isActiveForOutbound: true }}
      orgId="org-a"
      ownedByViewer
    />,
  )

  expect(screen.getByText('Primary')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Make primary' })).not.toBeInTheDocument()
})

it('lets the owner make an active number primary', async () => {
  const user = userEvent.setup()
  renderWithProviders(
    <Settings_PhoneNumbers_PrimaryControl number={NUMBER} orgId="org-a" ownedByViewer />,
  )

  await user.click(screen.getByRole('button', { name: 'Make primary' }))

  expect(setActiveMutateMock).toHaveBeenCalledWith(
    { orgId: 'org-a', id: 'num-1' },
    expect.anything(),
  )
})

it('shows no primary control for another member\'s number', () => {
  renderWithProviders(
    <Settings_PhoneNumbers_PrimaryControl number={NUMBER} orgId="org-a" ownedByViewer={false} />,
  )

  expect(screen.queryByText('Primary')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Make primary' })).not.toBeInTheDocument()
})
