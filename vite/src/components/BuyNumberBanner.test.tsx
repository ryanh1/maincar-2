// The dialer's caller-ID prompt.
//
// What these protect:
//   - it shows only when the org has no active caller ID
//   - it points at the phone numbers settings, where the buy lives
//   - it shows nothing while the numbers are still loading
import { beforeEach, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'

const { useGetNumbersMock, useAuthMock } = vi.hoisted(() => ({
  useGetNumbersMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/phoneNumbers', () => ({ useGetNumbers: useGetNumbersMock }))

import { BuyNumberBanner } from '@/components/BuyNumberBanner'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-a', name: 'Acme' } })
})

it('prompts the buy, linked to phone number settings, when there is no active number', () => {
  useGetNumbersMock.mockReturnValue({ data: { numbers: [], total: 0, activeCount: 0 } })

  renderWithProviders(<BuyNumberBanner />)

  expect(screen.getByText('You need a number to call out.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Buy a number' })).toHaveAttribute(
    'href',
    '/settings/numbers',
  )
})

it('renders nothing once the org has an active number', () => {
  useGetNumbersMock.mockReturnValue({
    data: { numbers: [{ id: 'n1' }], total: 1, activeCount: 1 },
  })

  const { container } = renderWithProviders(<BuyNumberBanner />)

  expect(container).toBeEmptyDOMElement()
})

it('renders nothing while the numbers are still loading', () => {
  useGetNumbersMock.mockReturnValue({ data: undefined })

  const { container } = renderWithProviders(<BuyNumberBanner />)

  expect(container).toBeEmptyDOMElement()
})
