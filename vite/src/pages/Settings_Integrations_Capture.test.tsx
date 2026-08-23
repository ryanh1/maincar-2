import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { jsonFetch, useAuthMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  jsonFetch: vi.fn(),
  useAuthMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})
vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_Integrations_Capture } from './Settings_Integrations_Capture'

const ORG = { id: 'org-1', name: 'Acme' }
const URL = '/api/orgs/org-1/settings/capture'
const OPT_OUT_URL = '/api/orgs/org-1/settings/capture/opt-out'

const RESPONSE = {
  captureSettings: {
    internalDomains: ['ourco.com'],
    allowDomains: [],
    excludeDomains: ['spam.com'],
    excludeAddresses: ['jane@ourco.com'],
    excludeRoleAddresses: true,
    dropBulkInbound: true,
    bulkInboundMax: 15,
    subjectExcludes: ['newsletter'],
    logActivityTypes: 'both',
    backfillMonths: 12,
  },
  optedOut: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true })
  jsonFetch.mockImplementation((input: string) => {
    if (input === URL) return Promise.resolve(RESPONSE)
    if (input === OPT_OUT_URL) return Promise.resolve({ optedOut: true })
    return Promise.resolve(undefined)
  })
})

describe('Settings_Integrations_Capture', () => {
  it('renders the admin settings with the saved values', async () => {
    renderWithProviders(<Settings_Integrations_Capture />)

    expect(await screen.findByText('ourco.com')).toBeInTheDocument()
    expect(screen.getByText('spam.com')).toBeInTheDocument()
    expect(screen.getByText('jane@ourco.com')).toBeInTheDocument()
    expect(screen.getByText('newsletter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save capture settings' })).toBeInTheDocument()
  })

  it('shows the section read-only to a non-admin', async () => {
    useAuthMock.mockReturnValue({ org: ORG, isAdmin: false })
    renderWithProviders(<Settings_Integrations_Capture />)

    expect(await screen.findByText('Set by your admin.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save capture settings' })).not.toBeInTheDocument()
  })

  it('persists the settings on save', async () => {
    renderWithProviders(<Settings_Integrations_Capture />)
    await screen.findByText('ourco.com')

    await userEvent.click(screen.getByRole('button', { name: 'Save capture settings' }))
    expect(screen.getByText(/Removing an exclusion resumes capture going forward/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(jsonFetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'PATCH' })),
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Capture settings saved.')
  })

  it('lets a member opt their own mailbox out', async () => {
    renderWithProviders(<Settings_Integrations_Capture />)
    await screen.findByText('ourco.com')

    const toggle = screen.getByRole('switch', { name: /Exclude my mailbox/i })
    await userEvent.click(toggle)

    await waitFor(() =>
      expect(jsonFetch).toHaveBeenCalledWith(OPT_OUT_URL, expect.objectContaining({ method: 'PUT' })),
    )
  })
})
