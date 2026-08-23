import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
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
  useGetTeamsMock,
  useGetObjectsMock,
  useGetObjectMock,
  useUpdateReportConfigMock,
  createMutateMock,
  renameMutateMock,
  deleteMutateMock,
  updateConfigMutateMock,
  toastErrorMock,
  toastSuccessMock,
  createEChartsMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetReportsMock: vi.fn(),
  useGetReportMock: vi.fn(),
  useRunReportMock: vi.fn(),
  useCreateReportMock: vi.fn(),
  useRenameReportMock: vi.fn(),
  useDeleteReportMock: vi.fn(),
  useGetTeamsMock: vi.fn(),
  useGetObjectsMock: vi.fn(),
  useGetObjectMock: vi.fn(),
  useUpdateReportConfigMock: vi.fn(),
  createMutateMock: vi.fn(),
  renameMutateMock: vi.fn(),
  deleteMutateMock: vi.fn(),
  updateConfigMutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  createEChartsMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/reports', () => ({
  useGetReports: useGetReportsMock,
  useGetReport: useGetReportMock,
  useRunReport: useRunReportMock,
  useCreateReport: useCreateReportMock,
  useRenameReport: useRenameReportMock,
  useDeleteReport: useDeleteReportMock,
  useUpdateReportConfig: useUpdateReportConfigMock,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))
vi.mock('@/hooks/orgs', () => ({ useGetTeams: useGetTeamsMock }))
vi.mock('@/dependencies/echarts', () => ({
  createECharts: () => ({ dispose: vi.fn(), getZr: () => ({ on: vi.fn() }), on: vi.fn(), resize: vi.fn(), setOption: createEChartsMock }),
}))
vi.mock('@/hooks/crm', () => ({
  useGetObjects: useGetObjectsMock,
  useGetObject: useGetObjectMock,
}))
vi.mock('@/components/crm/RecordGrid', () => ({
  RecordGrid: ({ viewConfig }: { viewConfig: { filterTree?: unknown } }) => (
    <div data-testid="drilled-record-grid">{JSON.stringify(viewConfig.filterTree)}</div>
  ),
}))

import { Reports } from '@/pages/Reports'

const CONFIG = {
  baseObject: 'deal' as const,
  rows: [{ field: 'stage' as const }],
  columns: [],
  values: [{ field: 'amountMinor' as const, aggregation: 'sum' as const }],
  timeZone: { mode: 'viewer' as const },
}

const OWNER_BY_STAGE_CONFIG = {
  baseObject: 'deal' as const,
  rows: [{ field: 'owner' as const }],
  columns: [{ field: 'stage' as const }],
  values: [{ field: 'amountMinor' as const, aggregation: 'sum' as const }],
  timeZone: { mode: 'viewer' as const },
}

const REPORT = {
  id: 'report-1',
  name: 'Pipeline by stage',
  kind: 'pivot',
  config: CONFIG,
  createdAt: '2026-08-22T12:00:00.000Z',
  updatedAt: '2026-08-22T12:00:00.000Z',
}

const ACTIVE_TEAM = {
  id: 'team-revenue',
  name: 'Revenue',
  leadUserId: 'lead-jordan',
  isArchived: false,
  members: [{ userId: 'lead-jordan', email: 'jordan@example.com', firstName: 'Jordan', lastName: 'Lee', title: null }],
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
    data: { report: { rows: [{ ownerId: 'user-a', ownerName: 'Avery Admin', stageId: 'stage-a', stageName: 'Discovery', amountMinor: '3500' }] } },
    isPending: false,
    isError: false,
  })
  useCreateReportMock.mockReturnValue({ mutate: createMutateMock, isPending: false })
  useRenameReportMock.mockReturnValue({ mutate: renameMutateMock, isPending: false })
  useDeleteReportMock.mockReturnValue({ mutate: deleteMutateMock, isPending: false })
  useUpdateReportConfigMock.mockReturnValue({ mutate: updateConfigMutateMock, isPending: false })
  useGetTeamsMock.mockImplementation((_orgId, params) => ({
    data: { teams: params?.isArchived ? [] : [ACTIVE_TEAM] },
    isPending: false,
    isError: false,
  }))
  useGetObjectsMock.mockReturnValue({
    data: { objects: [{ id: 'object-deal', slug: 'deal', name: 'Deal', namePlural: 'Deals', storage: 'table' }] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
  useGetObjectMock.mockReturnValue({
    data: {
      object: {
        id: 'object-deal', slug: 'deal', name: 'Deal', namePlural: 'Deals', storage: 'table',
        attributes: [
          { id: 'attribute-owner', slug: 'ownerUserId', name: 'Owner' },
          { id: 'attribute-stage', slug: 'stageId', name: 'Stage' },
        ],
      },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
})

function dragFieldToZone(field: string, zone: 'rows' | 'columns' | 'values') {
  const values = new Map<string, string>()
  const dataTransfer = {
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => values.set(type, value),
  }
  fireEvent.dragStart(screen.getByRole('button', { name: field, exact: true }), { dataTransfer })
  fireEvent.dragOver(screen.getByTestId(`drop-zone-${zone}`), { dataTransfer })
  fireEvent.drop(screen.getByTestId(`drop-zone-${zone}`), { dataTransfer })
}

describe('Reports', () => {
  it('lists a rep’s saved reports and opens one with its stored result', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    expect(screen.getByRole('heading', { name: /^Reports/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Pipeline by stage' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open Pipeline by stage' }))

    expect(screen.getByRole('heading', { name: 'Pipeline by stage' })).toBeInTheDocument()
    expect(screen.getByText('Discovery')).toBeInTheDocument()
    expect(screen.getAllByText('$35.00')).toHaveLength(2)
  })

  it('guides a rep from an empty reports home into a blank report', async () => {
    useGetReportsMock.mockReturnValue(listState({ data: { reports: [], total: 0 } }))
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    expect(screen.getByText('Create a report to see your pipeline.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New report' }))

    expect(screen.getByRole('heading', { name: 'Build a report in 3 steps' })).toBeInTheDocument()
    expect(screen.getByText('1 Pick data: Deals')).toBeInTheDocument()
    expect(screen.getByText('2 Drag a field to Rows')).toBeInTheDocument()
    expect(screen.getByText('3 Drag Amount to Values')).toBeInTheDocument()
    expect(screen.getByText('Drag a field here to group rows.')).toBeInTheDocument()
  })

  it('explains how to finish a not-yet-computable pivot and offers the next action', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('button', { name: 'Amount', exact: true }))

    expect(screen.getByRole('heading', { name: 'Add a group' })).toBeInTheDocument()
    expect(screen.getByText('Add a Row or Column to break Amount down.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Owner to Rows' }))

    expect(screen.getByRole('rowheader', { name: 'Avery Admin' })).toBeInTheDocument()
  })

  it('explains when filters match no records and lets a rep loosen them', async () => {
    useRunReportMock.mockReturnValue({
      data: { report: { rows: [] } },
      isPending: false,
      isError: false,
    })
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('checkbox', { name: 'Revenue' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Amount', 'values')

    expect(screen.getByText('No records match these filters.')).toBeInTheDocument()
    expect(screen.getByText('Owner\'s team filter')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Loosen filters' }))

    expect(screen.getByText('All owners.')).toBeInTheDocument()
  })

  it('labels a report that is still preparing instead of leaving a blank grid', async () => {
    useRunReportMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Amount', 'values')

    expect(screen.getByText('Preparing this report…')).toBeInTheDocument()
  })

  it('requires a name before it saves a new report', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Stage', 'columns')
    dragFieldToZone('Amount', 'values')
    await user.click(screen.getByRole('button', { name: 'Save report' }))
    await user.type(screen.getByLabelText(/^Name/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(toastErrorMock).toHaveBeenCalledWith('Name the report to save it.')
    expect(createMutateMock).not.toHaveBeenCalled()
  })

  it('saves an owner team scope and summarizes the live selection', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('checkbox', { name: 'Revenue' }))
    await user.click(screen.getByRole('checkbox', { name: 'Teams led by Jordan Lee' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Stage', 'columns')
    dragFieldToZone('Amount', 'values')

    expect(screen.getByText('Owner is on Revenue or teams led by Jordan Lee.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save report' }))
    await user.type(screen.getByLabelText(/^Name/), 'Jordan pipeline')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(createMutateMock).toHaveBeenCalledWith(
      {
        orgId: 'org-a',
        name: 'Jordan pipeline',
        config: {
          ...OWNER_BY_STAGE_CONFIG,
          filters: { ownerTeam: { teamIds: ['team-revenue'], leadUserIds: ['lead-jordan'] } },
        },
      },
      expect.any(Object),
    )
  })

  it('shows an archived saved team as unavailable and lets the member remove it', async () => {
    const archivedReport = {
      ...REPORT,
      config: { ...CONFIG, filters: { ownerTeam: { teamIds: ['team-archived'] } } },
    }
    useGetReportMock.mockImplementation((_orgId, reportId) => ({
      data: reportId ? { report: archivedReport } : undefined,
      isPending: false,
      isError: false,
    }))
    useGetTeamsMock.mockImplementation((_orgId, params) => ({
      data: {
        teams: params?.isArchived
          ? [{ ...ACTIVE_TEAM, id: 'team-archived', name: 'Former Revenue', isArchived: true }]
          : [ACTIVE_TEAM],
      },
      isPending: false,
      isError: false,
    }))
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'Open Pipeline by stage' }))
    expect(screen.getByText('Former Revenue (Unavailable)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Former Revenue' }))

    expect(screen.getByText('All owners.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('builds an Owner-by-Stage pivot live and includes a grand total', async () => {
    useRunReportMock.mockReturnValue({
      data: {
        report: {
          rows: [
            { ownerId: 'user-a', ownerName: 'Avery Admin', stageId: 'stage-a', stageName: 'Discovery', amountMinor: '3500' },
            { ownerId: 'user-a', ownerName: 'Avery Admin', stageId: 'stage-b', stageName: 'Won', amountMinor: '1500' },
          ],
        },
      },
      isPending: false,
      isError: false,
    })
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Stage', 'columns')
    dragFieldToZone('Amount', 'values')

    expect(screen.getByRole('columnheader', { name: 'Discovery' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Won' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Avery Admin' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Grand total' })).toBeInTheDocument()
    expect(await screen.findAllByText('$50.00')).toHaveLength(2)
  })

  it('adds Segment to the pivot and renders its Unspecified group', async () => {
    useRunReportMock.mockReturnValue({ data: { report: { rows: [
      { segmentId: 'Enterprise', segmentName: 'Enterprise', amountMinor: '3500' },
      { segmentId: 'unspecified', segmentName: 'Unspecified', amountMinor: '1500' },
    ] } }, isPending: false, isError: false })
    const user = userEvent.setup()
    renderWithProviders(<Reports />)
    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Segment', 'rows')
    dragFieldToZone('Amount', 'values')
    expect(screen.getByRole('columnheader', { name: 'Segment' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Enterprise' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Unspecified' })).toBeInTheDocument()
  })

  it('adds an average as a one-click measure and uses the server grand total', async () => {
    useRunReportMock.mockReturnValue({ data: { report: {
      rows: [{ stageId: 'stage-a', stageName: 'Discovery', value: '2300' }],
      rollups: [{ groupedFields: [], value: '3700' }],
    } }, isPending: false, isError: false })
    const user = userEvent.setup()
    renderWithProviders(<Reports />)
    await user.click(screen.getByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('button', { name: 'Stage', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Average amount', exact: true }))
    expect(screen.getByTestId('drop-zone-values')).toHaveTextContent('Average amount')
    expect(screen.getByText('$23.00')).toBeInTheDocument()
    expect(screen.getByText('$37.00')).toBeInTheDocument()
  })

  it('adds a percent summary row only under the selected pivot row', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Stage', 'columns')
    dragFieldToZone('Amount', 'values')
    await user.click(screen.getByRole('checkbox', { name: 'Add summary row under Avery Admin' }))

    expect(screen.getByRole('rowheader', { name: 'Avery Admin % of grand total' })).toBeInTheDocument()
  })

  it('switches a live pivot between its table and chart without changing the query', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Stage', 'columns')
    dragFieldToZone('Amount', 'values')
    expect(screen.getByRole('table', { name: 'Deals pivot' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Chart' }))
    expect(screen.getByLabelText('Report chart')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('table', { name: 'Deals pivot' })).toBeInTheDocument()
  })

  it('lets a keyboard user add fields to the builder', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('button', { name: 'Owner', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Stage', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Amount', exact: true }))

    expect(screen.getByRole('button', { name: 'Save report' })).toBeEnabled()
    expect(screen.getByRole('rowheader', { name: 'Avery Admin' })).toBeInTheDocument()
  })

  it('opens the exact pivot records and widens them when a drill chip is removed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Stage', 'columns')
    dragFieldToZone('Amount', 'values')

    fireEvent.doubleClick(screen.getAllByText('$35.00')[0]!)

    expect(screen.getByRole('heading', { name: 'Deals' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter Owner: Avery Admin' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter Stage: Discovery' })).toBeInTheDocument()
    expect(screen.getByTestId('drilled-record-grid')).toHaveTextContent('attribute-owner')
    expect(screen.getByTestId('drilled-record-grid')).toHaveTextContent('attribute-stage')

    await user.click(screen.getByRole('button', { name: 'Remove filter Stage: Discovery' }))

    expect(screen.getByTestId('drilled-record-grid')).toHaveTextContent('attribute-owner')
    expect(screen.getByTestId('drilled-record-grid')).not.toHaveTextContent('attribute-stage')
  })

  it('saves, renames, and moves a report to Trash only after confirmation', async () => {
    createMutateMock.mockImplementation((_variables, options) => options.onSuccess({ report: REPORT }))
    renameMutateMock.mockImplementation((_variables, options) => options.onSuccess())
    deleteMutateMock.mockImplementation((_variables, options) => options.onSuccess())
    const user = userEvent.setup()
    renderWithProviders(<Reports />)

    await user.click(screen.getByRole('button', { name: 'New report' }))
    dragFieldToZone('Owner', 'rows')
    dragFieldToZone('Stage', 'columns')
    dragFieldToZone('Amount', 'values')
    await user.click(screen.getByRole('button', { name: 'Save report' }))
    await user.type(screen.getByLabelText(/^Name/), 'Quarterly pipeline')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(createMutateMock).toHaveBeenCalledWith(
      { orgId: 'org-a', name: 'Quarterly pipeline', config: OWNER_BY_STAGE_CONFIG },
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
