import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetRecordingPolicyMock, useUpdateRecordingPolicyMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetRecordingPolicyMock: vi.fn(),
  useUpdateRecordingPolicyMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/recordingPolicy', () => ({
  useGetRecordingPolicy: useGetRecordingPolicyMock,
  useUpdateRecordingPolicy: useUpdateRecordingPolicyMock,
}))

import { Settings_CallRecordingsTab } from '@/pages/Settings_CallRecordingsTab'

const ORG = { id: 'org-a', name: 'Acme' }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true })
  useUpdateRecordingPolicyMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
})

describe('Settings_CallRecordingsTab', () => {
  it('shows the default policy controls', () => {
    useGetRecordingPolicyMock.mockReturnValue({
      isError: false,
      isLoading: false,
      data: { recordingPolicy: { recordCalls: true, blockTwoPartyConsentStates: true, allowedStates: [] } },
    })

    renderWithProviders(<Settings_CallRecordingsTab />)

    expect(screen.getByRole('switch', { name: 'Record calls' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Do not record in two-party-consent states' })).toBeChecked()
    expect(screen.getByText('Leave empty to record every state allowed by the settings above.')).toBeInTheDocument()
  })

  it('shows an actionable error when the initial policy request fails', () => {
    useGetRecordingPolicyMock.mockReturnValue({ isError: true, isLoading: false, data: undefined })

    renderWithProviders(<Settings_CallRecordingsTab />)

    expect(screen.getByText('Could not load call recordings. Refresh and try again.')).toBeInTheDocument()
    expect(screen.queryByText('Loading call recordings.')).not.toBeInTheDocument()
  })
})
