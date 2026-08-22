import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetReportsMock,
  useGetReportMock,
  useRunReportMock,
  useCreateReportMock,
  useRenameReportMock,
  useDeleteReportMock,
  createMutateMock,
  renameMutateMock,
  deleteMutateMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetReportsMock: vi.fn(),
  useGetReportMock: vi.fn(),
  useRunReportMock: vi.fn(),
  useCreateReportMock: vi.fn(),
  useRenameReportMock: vi.fn(),
  useDeleteReportMock: vi.fn(),
  createMutateMock: vi.fn(),
  renameMutateMock: vi.fn(),
  deleteMutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/reports', () => ({
  useGetReports: useGetReportsMock,
  useGetReport: useGetReportMock,
  useRunReport: useRunReportMock,
  useCreateReport: useCreateReportMock,
  useRenameReport: useRenameReportMock,
  useDeleteReport: useDeleteReportMock,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Reports } from '@/pages/Reports'

const CONFIG = {
  baseObject: 'deal' as const,
  rows: [{ field: 'stage' as const }],
  values: [{ field: 'amountMinor' as const, aggregation: 'sum' as const }],
}

const REPORT = {
  id: 'report-1',
  name: 'Pipeline by stage',
  kind: 'pivot',
  config: CONFIG,
  createdAt: '2026-08-22T12:00:00.000Z',
  updatedAt: '2026-08-22T12:00:00.000Z',
}

function listState(overrides: Record<string, unknown> = {}) {
  return {
    data: { reports: [REPORT], total: 1 },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-a', name: 'Acme' } })
  useGetReportsMock.mockReturnValue(listState())
  useGetReportMock.mockImplementation((_orgId, reportId) => ({
    data: reportId ? { report: REPORT } : undefined,
    isPending: false,
    isError: false,
  }))
  useRunReportMock.mockReturnValue({
    data: { report: { rows: [{ stageId: 'stage-a', stageName: 'Discovery', amountMinor: '3500' }] } },
    isPending: false,
    isError: false,
  })
  useCreateReportMock.mockReturnValue({ mutate: createMutateMock, isPending: false })
  useRenameReportMock.mockReturnValue({ mutate: renameMutateMock, isPending: false })
  useDeleteReportMock.mockReturnValue({ mutate: deleteMutateMock, isPending: false })
})

describe('Reports', () => {
  it('lists a rep’s saved reports and opens one with its stored result', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    expect(screen.getByRole('heading', { name: /^Reports/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Pipeline by stage' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open Pipeline by stage' }))

    expect(screen.getByRole('heading', { name: 'Pipeline by stage' })).toBeInTheDocument()
    expect(screen.getByText('Discovery')).toBeInTheDocument()
    expect(screen.getByText('$35.00')).toBeInTheDocument()
  })

  it('requires a name before it saves a new report', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('button', { name: 'Save report' }))
    await user.type(screen.getByLabelText(/^Name/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(toastErrorMock).toHaveBeenCalledWith('Name the report to save it.')
    expect(createMutateMock).not.toHaveBeenCalled()
  })

  it('saves, renames, and moves a report to Trash only after confirmation', async () => {
    createMutateMock.mockImplementation((_variables, options) => options.onSuccess({ report: REPORT }))
    renameMutateMock.mockImplementation((_variables, options) => options.onSuccess())
    deleteMutateMock.mockImplementation((_variables, options) => options.onSuccess())
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('button', { name: 'Save report' }))
    await user.type(screen.getByLabelText(/^Name/), 'Quarterly pipeline')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(createMutateMock).toHaveBeenCalledWith(
      { orgId: 'org-a', name: 'Quarterly pipeline', config: CONFIG },
      expect.any(Object),
    )

    await user.click(screen.getByRole('button', { name: 'Rename report' }))
    const name = screen.getByLabelText(/^Name/)
    await user.clear(name)
    await user.type(name, 'Pipeline Q3')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(renameMutateMock).toHaveBeenCalledWith(
      { orgId: 'org-a', reportId: 'report-1', name: 'Pipeline Q3' },
      expect.any(Object),
    )

    await user.click(screen.getByRole('button', { name: 'Delete report' }))
    expect(deleteMutateMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteMutateMock).toHaveBeenCalledWith(
      { orgId: 'org-a', reportId: 'report-1' },
      expect.any(Object),
    )
  })
})
