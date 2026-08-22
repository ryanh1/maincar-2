import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
      data: { recordingPolicy: { recordCalls: true, blockedStates: ['CA', 'UNKNOWN'] } },
    })

    renderWithProviders(<Settings_CallRecordingsTab />)

    expect(screen.getByRole('switch', { name: 'Record calls' })).toBeChecked()
    expect(screen.getByText('Do not record in the following states')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove california/i })).not.toBeInTheDocument()
  })

  it('applies the two-party preset inside the selected-state picker', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    useGetRecordingPolicyMock.mockReturnValue({
      isError: false,
      isLoading: false,
      data: { recordingPolicy: { recordCalls: true, blockedStates: [] } },
    })
    useUpdateRecordingPolicyMock.mockReturnValue({ isPending: false, mutateAsync })

    renderWithProviders(<Settings_CallRecordingsTab />)
    await user.click(screen.getByRole('button', { name: /select states/i }))
    await user.click(screen.getByRole('button', { name: 'Two-party consent states' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      blockedStates: expect.arrayContaining(['CA', 'CT', 'WA']),
    })
  })

  it('shows an actionable error when the initial policy request fails', () => {
    useGetRecordingPolicyMock.mockReturnValue({ isError: true, isLoading: false, data: undefined })

    renderWithProviders(<Settings_CallRecordingsTab />)

    expect(screen.getByText('Could not load call recordings. Refresh and try again.')).toBeInTheDocument()
    expect(screen.queryByText('Loading call recordings.')).not.toBeInTheDocument()
  })
})
