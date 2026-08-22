import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'
import type { CallDetail } from '@/lib/callTypes'

const { useGetDispositionsMock, useLogCallDispositionMock } = vi.hoisted(() => ({
  useGetDispositionsMock: vi.fn(),
  useLogCallDispositionMock: vi.fn(),
}))

vi.mock('@/hooks/dispositions', () => ({ useGetDispositions: useGetDispositionsMock }))
vi.mock('@/hooks/dialer', () => ({ useLogCallDisposition: useLogCallDispositionMock }))

import { CallDetail_DispositionForm } from './CallDetail_DispositionForm'

const call: CallDetail = {
  id: 'call-1', direction: 'outbound', status: 'completed', fromE164: '+12025550123', toE164: '+13035550199',
  recordingPlanned: false, recordingReason: 'recording-disabled', twilioCallSid: null, createdAt: '2026-08-22T12:00:00.000Z', durationS: 30,
  startedAt: '2026-08-22T12:00:00.000Z', endedAt: '2026-08-22T12:00:30.000Z', transcriptStatus: 'skipped-not-recorded', destinationState: null,
  recordingEnabled: false, recordingUrl: null, transcript: null, disposition: null, noteText: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  useLogCallDispositionMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({ call }) })
})

describe('CallDetail_DispositionForm', () => {
  it('points a rep to settings when no disposition can be logged', () => {
    useGetDispositionsMock.mockReturnValue({ isPending: false, isError: false, data: { dispositions: [] } })

    renderWithProviders(<CallDetail_DispositionForm orgId="org-a" call={call} />)

    expect(screen.getByRole('link', { name: 'Manage dispositions' })).toHaveAttribute('href', '/settings?tab=dispositions')
  })

  it('saves the selected outcome and note', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ call })
    useLogCallDispositionMock.mockReturnValue({ isPending: false, mutateAsync })
    useGetDispositionsMock.mockReturnValue({ isPending: false, isError: false, data: { dispositions: [{ id: 'disposition-1', value: 'connected', label: 'Connected', color: 'option-1', icon: null, category: 'connected', isStandard: true, sortOrder: 0, isArchived: false, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z' }] } })

    renderWithProviders(<CallDetail_DispositionForm orgId="org-a" call={call} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Disposition' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Connected' }))
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Asked for a demo.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ dispositionId: 'disposition-1', noteText: 'Asked for a demo.' }))
  })
})
