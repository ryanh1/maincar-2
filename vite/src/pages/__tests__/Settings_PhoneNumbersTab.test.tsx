// Settings → Phone numbers.
//
// What these protect:
//   - the status is shown as a label, never the raw enum
//   - a provisioning row shows a spinner, not just a word
//   - the "Bought on" column renders a timezone-resolved date
//   - search, sort, and pagination all work over the fetched list
//   - the empty state invites the buy rather than explaining emptiness
//   - the buy dialog searches through the hook and lists results with a price
//   - buying confirms the monthly cost first, then sends the chosen number's e164
//   - picking the number to call from sends that number's id
//   - loading and error both have honest states
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useGetNumbersMock,
  useGetOrgNumbersMock,
  useSetActiveNumberMock,
  useReleaseNumberMock,
  useSearchAvailableNumbersMock,
  useBuyNumberMock,
  useAuthMock,
  setActiveMutateMock,
  releaseMutateMock,
  searchMutateMock,
  buyMutateAsyncMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useGetNumbersMock: vi.fn(),
  useGetOrgNumbersMock: vi.fn(),
  useSetActiveNumberMock: vi.fn(),
  useReleaseNumberMock: vi.fn(),
  useSearchAvailableNumbersMock: vi.fn(),
  useBuyNumberMock: vi.fn(),
  useAuthMock: vi.fn(),
  setActiveMutateMock: vi.fn(),
  releaseMutateMock: vi.fn(),
  searchMutateMock: vi.fn(),
  buyMutateAsyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/phoneNumbers', () => ({
  useGetNumbers: useGetNumbersMock,
  useGetOrgNumbers: useGetOrgNumbersMock,
  useAssignNumber: () => ({ mutate: vi.fn(), isPending: false }),
  useSetActiveNumber: useSetActiveNumberMock,
  useReleaseNumber: useReleaseNumberMock,
  useSearchAvailableNumbers: useSearchAvailableNumbersMock,
  useBuyNumber: useBuyNumberMock,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_PhoneNumbersTab } from '@/pages/Settings_PhoneNumbersTab'

const ORG = { id: 'org-a', name: 'Acme' }
// Fixed so "Bought on" assertions do not depend on the machine's local zone.
const USER = { timeZone: 'America/New_York' }

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
      number({
        id: 'num-searching',
        e164: '+12025550133',
        status: 'searching',
        twilioSid: null,
        isActiveForOutbound: false,
      }),
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
  useAuthMock.mockReturnValue({ org: ORG, user: USER, isAdmin: false })
  useGetNumbersMock.mockReturnValue(listState())
  useGetOrgNumbersMock.mockReturnValue({ isPending: false, isError: false, data: { numbers: [], total: 0, unassignedCount: 0 } })
  useSetActiveNumberMock.mockReturnValue({ mutate: setActiveMutateMock, isPending: false })
  useReleaseNumberMock.mockReturnValue({ mutate: releaseMutateMock, isPending: false })
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

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Provisioning…')).toBeInTheDocument()
    // The raw enum values never reach the screen.
    expect(screen.queryByText('active')).not.toBeInTheDocument()
    expect(screen.queryByText('searching')).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Number' }).closest('tr')).toHaveClass('bg-surface')
  })

  it('shows a spinner beside a row that is still provisioning', () => {
    const { container } = renderWithProviders(<Settings_PhoneNumbersTab />)

    // Only the "searching" row gets one — active and ready rows do not.
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
  })

  it('renders a "Bought on" column, timezone-resolved', () => {
    renderWithProviders(<Settings_PhoneNumbersTab />)

    // 2026-08-01T12:00:00Z in America/New_York is still the morning of Aug 1.
    expect(screen.getAllByText('Aug 1, 2026').length).toBeGreaterThan(0)
  })

  it('shows a Primary label for the active number and enables Make primary only when ready', () => {
    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.getAllByText('Primary')).toHaveLength(2)
    const makePrimary = screen.getAllByRole('button', { name: 'Make primary' })
    expect(makePrimary[0]).toBeEnabled()
    expect(makePrimary[1]).toBeDisabled()
  })

  it('sends the chosen number id when Make primary is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getAllByRole('button', { name: 'Make primary' })[0])

    expect(setActiveMutateMock).toHaveBeenCalledWith(
      { orgId: 'org-a', id: 'num-ready' },
      expect.anything(),
    )
  })

  it('keeps the my-numbers toggle on and disabled for a non-admin', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    const toggle = screen.getByRole('switch', { name: 'Show only my numbers' })
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()

    await user.hover(toggle.parentElement!)
    expect(await screen.findByText('You must be an admin to do that.')).toBeInTheDocument()
  })

  it('shows every organization number by default for an admin and can filter to the admin\'s numbers', async () => {
    useAuthMock.mockReturnValue({ org: ORG, user: { ...USER, id: 'user-a' }, isAdmin: true })
    useGetOrgNumbersMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        numbers: [
          {
            ...number({ id: 'num-colleague', e164: '+12025550999', isActiveForOutbound: false }),
            assignedUser: { id: 'user-b', firstName: 'Bee', lastName: 'Ta', email: 'b@acme.com' },
          },
        ],
        total: 1,
        unassignedCount: 0,
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.getByText('+12025550999')).toBeInTheDocument()
    expect(screen.queryByText('+12025550111')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Show only my numbers' }))
    expect(screen.getByText('+12025550111')).toBeInTheDocument()
    expect(screen.queryByText('+12025550999')).not.toBeInTheDocument()
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

describe('search', () => {
  it('filters the list by number as the search box is typed into', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.type(screen.getByRole('textbox', { name: 'Search phone numbers' }), '0122')

    expect(screen.queryByText('+12025550111')).not.toBeInTheDocument()
    expect(screen.getByText('+12025550122')).toBeInTheDocument()
  })

  it('says so, and offers to clear, when nothing matches', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.type(screen.getByRole('textbox', { name: 'Search phone numbers' }), 'nope')

    expect(
      screen.getByText('No number matches this search. Clear the search to see them all.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByText('+12025550111')).toBeInTheDocument()
  })
})

describe('sort', () => {
  it('reorders the rows and flips direction on a second click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    const rowsInOrder = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)

    // Default sort is "Bought on" (createdAt) descending — all three fixtures
    // share a createdAt, so the natural array order holds.
    expect(rowsInOrder()).toEqual(['+12025550111', '+12025550122', '+12025550133'])

    await user.click(screen.getByRole('button', { name: 'Sort by Number' }))
    expect(rowsInOrder()).toEqual(['+12025550111', '+12025550122', '+12025550133'])

    await user.click(screen.getByRole('button', { name: 'Sort by Number' }))
    expect(rowsInOrder()).toEqual(['+12025550133', '+12025550122', '+12025550111'])
  })
})

describe('pagination', () => {
  function manyNumbers(count: number) {
    return Array.from({ length: count }, (_, i) =>
      number({
        id: `num-${i}`,
        e164: `+1202555${String(i).padStart(4, '0')}`,
        createdAt: new Date(2026, 0, i + 1).toISOString(),
      }),
    )
  }

  it('shows 25 rows a page, and pages through the rest', async () => {
    useGetNumbersMock.mockReturnValue(
      listState({ data: numbersResponse({ numbers: manyNumbers(30), total: 30 }) }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + 25 rows
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(6) // header + 5 remaining rows
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('shows no pager at all under 25 numbers', () => {
    renderWithProviders(<Settings_PhoneNumbersTab />)

    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument()
  })
})

describe('releasing a number', () => {
  it('names the number and says the release cannot be undone', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for +12025550122' }))
    await user.click(screen.getByRole('menuitem', { name: 'Release this number' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Release +12025550122?')).toBeInTheDocument()
    expect(within(dialog).getByText(/cannot get this number again/)).toBeInTheDocument()
  })

  it('sends the number id when the release is confirmed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for +12025550122' }))
    await user.click(screen.getByRole('menuitem', { name: 'Release this number' }))
    await user.click(screen.getByRole('button', { name: 'Release' }))

    expect(releaseMutateMock).toHaveBeenCalledWith(
      { orgId: 'org-a', id: 'num-ready' },
      expect.anything(),
    )
  })

  // Releasing the active call-from number is blocked while another dialable number exists —
  // the menu item names the first step rather than just refusing.
  it('blocks releasing the active call-from number while another number can take over', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for +12025550111' }))

    expect(screen.getByRole('menuitem', { name: 'Choose another number to call from first' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  // The one case the server lets through: no other dialable number to fall back
  // on, so the confirm states the consequence instead of the control being blocked.
  it('allows releasing the last dialable number and warns calling will stop', async () => {
    useGetNumbersMock.mockReturnValue(
      listState({
        data: numbersResponse({
          numbers: [
            number({ id: 'num-active', isActiveForOutbound: true }),
            number({
              id: 'num-failed',
              e164: '+12025550144',
              status: 'failed',
              twilioSid: null,
              isActiveForOutbound: false,
            }),
          ],
        }),
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for +12025550111' }))
    expect(screen.getByRole('menuitem', { name: 'Release this number' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await user.click(screen.getByRole('menuitem', { name: 'Release this number' }))
    expect(screen.getByText(/cannot place calls until you buy another number/)).toBeInTheDocument()
  })

  it('cannot be released while it is still being bought', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for +12025550133' }))

    expect(screen.getByRole('menuitem', { name: 'Wait until it is ready' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('surfaces the server’s refusal as a toast', async () => {
    releaseMutateMock.mockImplementation((_vars, { onError }) => {
      onError({ message: 'Choose a different number to call from first, then release this one.' })
    })
    const user = userEvent.setup()
    renderWithProviders(<Settings_PhoneNumbersTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for +12025550122' }))
    await user.click(screen.getByRole('menuitem', { name: 'Release this number' }))
    await user.click(screen.getByRole('button', { name: 'Release' }))

    expect(toastErrorMock).toHaveBeenCalledWith('Could not release the number. Try again.')
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

  it('confirms the monthly cost before buying, and does not buy on cancel', async () => {
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

    const confirm = screen.getByRole('alertdialog')
    expect(within(confirm).getByText('Buy (323) 555-0111?')).toBeInTheDocument()
    expect(within(confirm).getByText(/\$1\.15\/mo/)).toBeInTheDocument()

    // Buying has not happened yet — only the confirm is open.
    expect(buyMutateAsyncMock).not.toHaveBeenCalled()

    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(buyMutateAsyncMock).not.toHaveBeenCalled()
  })

  it('buys the chosen number by its e164 once the confirm is accepted', async () => {
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

    const confirm = screen.getByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Buy' }))

    await waitFor(() =>
      expect(buyMutateAsyncMock).toHaveBeenCalledWith({ orgId: 'org-a', e164: '+13235550111' }),
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Number added. It is provisioning now.')
  })
})
