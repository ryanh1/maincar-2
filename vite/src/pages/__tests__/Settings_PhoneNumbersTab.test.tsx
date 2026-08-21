// Settings → Phone numbers.
//
// What these protect:
//   - the status is shown as a label, never the raw enum
//   - the empty state invites the buy rather than explaining emptiness
//   - the buy dialog searches through the hook and lists results with a price
//   - buying sends the chosen number's e164
//   - picking a caller ID sends that number's id
//   - loading and error both have honest states
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useGetNumbersMock,
  useSetActiveNumberMock,
  useSearchAvailableNumbersMock,
  useBuyNumberMock,
  useAuthMock,
  setActiveMutateMock,
  searchMutateMock,
  buyMutateAsyncMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useGetNumbersMock: vi.fn(),
  useSetActiveNumberMock: vi.fn(),
  useSearchAvailableNumbersMock: vi.fn(),
  useBuyNumberMock: vi.fn(),
  useAuthMock: vi.fn(),
  setActiveMutateMock: vi.fn(),
  searchMutateMock: vi.fn(),
  buyMutateAsyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/phoneNumbers', () => ({
  useGetNumbers: useGetNumbersMock,
  useSetActiveNumber: useSetActiveNumberMock,
  useSearchAvailableNumbers: useSearchAvailableNumbersMock,
  useBuyNumber: useBuyNumberMock,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_PhoneNumbersTab } from '@/pages/Settings_PhoneNumbersTab'

const ORG = { id: 'org-a', name: 'Acme' }

function number(overrides: Record<string, unknown> = {}) {
  return {
    id: 'num-active',
    e164: '+12025550111',
    twilioSid: 'PN1',
    status: 'active',
    isActiveForOutbound: true,
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

function numbersResponse(overrides: Record<string, unknown> = {}) {
  return {
    numbers: [
      number(),
      number({ id: 'num-ready', e164: '+12025550122', isActiveForOutbound: false }),
      number({ id: 'num-searching', e164: '+12025550133', status: 'searching', twilioSid: null, isActiveForOutbound: false }),
    ],
    total: 3,
    activeCount: 1,
    ...overrides,
  }
}

function listState(overrides: Record<string, unknown> = {}) {
  return {
    data: numbersResponse(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

function searchState(overrides: Record<string, unknown> = {}) {
  return {
    mutate: searchMutateMock,
    data: undefined,
    error: null,
    isPending: false,
    isError: false,
    isSuccess: false,
    variables: undefined,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG })
  useGetNumbersMock.mockReturnValue(listState())
  useSetActiveNumberMock.mockReturnValue({ mutate: setActiveMutateMock, isPending: false })
  useSearchAvailableNumbersMock.mockReturnValue(searchState())
  useBuyNumberMock.mockReturnValue({
    mutateAsync: buyMutateAsyncMock,
    isPending: false,
    variables: undefined,
  })
})

describe('the numbers list', () => {
  it('shows a mapped status label, never the raw enum', () => {
    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.getByText('Active caller ID')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Provisioning…')).toBeInTheDocument()
    // The raw enum values never reach the screen.
    expect(screen.queryByText('active')).not.toBeInTheDocument()
    expect(screen.queryByText('searching')).not.toBeInTheDocument()
  })

  it('lets a dialable number be made the caller ID, and disables the rest', () => {
    renderWithProviders(<Settings_PhoneNumbersTab />)

    // The active number's radio is checked and disabled — it is already the one.
    expect(screen.getByRole('radio', { name: 'Set +12025550111 as caller ID' })).toBeDisabled()
    // A dialable, not-yet-active number can be picked.
    expect(screen.getByRole('radio', { name: 'Set +12025550122 as caller ID' })).toBeEnabled()
    // A provisioning number cannot be picked yet.
    expect(screen.getByRole('radio', { name: 'Set +12025550133 as caller ID' })).toBeDisabled()
  })

  it('sends the chosen number id when a caller ID is picked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('radio', { name: 'Set +12025550122 as caller ID' }))

    expect(setActiveMutateMock).toHaveBeenCalledWith(
      { orgId: 'org-a', id: 'num-ready' },
      expect.anything(),
    )
  })

  it('shows a loading state while the numbers load', () => {
    useGetNumbersMock.mockReturnValue(listState({ data: undefined, isPending: true }))

    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.queryByText('+12025550111')).not.toBeInTheDocument()
  })

  it('offers a retry when the list fails to load', async () => {
    const refetch = vi.fn()
    useGetNumbersMock.mockReturnValue(
      listState({ data: undefined, isPending: false, isError: true, refetch }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.getByText('Could not load your numbers.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(refetch).toHaveBeenCalled()
  })
})

describe('the empty state', () => {
  it('invites the buy rather than explaining emptiness', () => {
    useGetNumbersMock.mockReturnValue(
      listState({ data: numbersResponse({ numbers: [], total: 0, activeCount: 0 }) }),
    )
    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.getByText('You need a number to call out.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy a number' })).toBeInTheDocument()
  })
})

describe('the buy dialog', () => {
  it('searches through the hook and lists results with a price', async () => {
    useSearchAvailableNumbersMock.mockReturnValue(
      searchState({
        isSuccess: true,
        data: {
          numbers: [
            { e164: '+13235550111', friendly: '(323) 555-0111', priceMonthly: '1.15' },
            { e164: '+13235550122', friendly: '(323) 555-0122', priceMonthly: null },
          ],
          total: 2,
          priceUnit: 'USD',
        },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Buy a number' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('(323) 555-0111')).toBeInTheDocument()
    expect(within(dialog).getByText('$1.15/mo')).toBeInTheDocument()
    // A null price shows a dash, not a bare amount.
    expect(within(dialog).getByText('—')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Search' }))

    expect(searchMutateMock).toHaveBeenCalledWith({
      orgId: 'org-a',
      country: 'US',
      areaCode: undefined,
      contains: undefined,
    })
  })

  it('buys the chosen number by its e164', async () => {
    buyMutateAsyncMock.mockResolvedValue({ number: number() })
    useSearchAvailableNumbersMock.mockReturnValue(
      searchState({
        isSuccess: true,
        data: {
          numbers: [{ e164: '+13235550111', friendly: '(323) 555-0111', priceMonthly: '1.15' }],
          total: 1,
          priceUnit: 'USD',
        },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Buy a number' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Buy +13235550111' }))

    await waitFor(() =>
      expect(buyMutateAsyncMock).toHaveBeenCalledWith({ orgId: 'org-a', e164: '+13235550111' }),
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Number added. It is provisioning now.')
  })
})
