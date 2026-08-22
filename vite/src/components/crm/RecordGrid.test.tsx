/**
 * The canvas Glide draws to isn't available in jsdom, so `DataEditor` itself is
 * mocked out — this test is about the WIRING this component does around it
 * (which columns it builds, freezing the leading one, what it renders while
 * loading/erroring/empty), not about canvas rendering. Real rendering and 60fps
 * scroll are verified in the browser (CLAUDE.md → Verification before finishing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { RecordGrid } from './RecordGrid'
import { createViewConfig } from './viewConfig'

const useRecordWindow = vi.hoisted(() => vi.fn())
const useGetActivity = vi.hoisted(() => vi.fn(() => ({ isPending: false, isError: false, data: undefined })))
const mutateAsync = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const useUpdateRecordValue = vi.hoisted(() => vi.fn(() => ({ mutateAsync })))
const createMutateAsync = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const useCreateRecord = vi.hoisted(() => vi.fn(() => ({ mutateAsync: createMutateAsync, isPending: false })))
const dataEditorScrollTo = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/crm', () => ({ useRecordWindow, useGetActivity, useUpdateRecordValue, useCreateRecord }))

vi.mock('@/providers/useAuth', () => ({
  useAuth: () => ({ user: { timeZone: 'America/New_York' } }),
}))

// The real module pulls in canvas rendering internals jsdom cannot run, and this
// test is about RecordGrid's own wiring (columns, freezing, cell lookup,
// prefetch) rather than canvas drawing — so the whole module is replaced, not
// partially mocked over the real one.
const dataEditorProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  frozenRows: null as Record<string, unknown> | null,
}))
vi.mock('@glideapps/glide-data-grid', () => ({
  DataEditor: (props: Record<string, unknown>) => {
    if (props.className === 'record-grid-frozen-rows') {
      dataEditorProps.frozenRows = props
      return <div data-testid="frozen-rows-editor" />
    }
    dataEditorProps.current = props
    const ref = props.ref as { current: { scrollTo: typeof dataEditorScrollTo } | null } | undefined
    if (ref) ref.current = { scrollTo: dataEditorScrollTo }
    return <div data-testid="data-editor" />
  },
  GridCellKind: { Loading: 'loading', Text: 'text', Number: 'number', Boolean: 'boolean', Custom: 'custom' },
  emptyGridSelection: { current: undefined, columns: { items: [] }, rows: { items: [] } },
  roundedRect: () => {},
}))

const TEST_OBJECT = {
  id: 'obj-1',
  slug: 'test-object',
  name: 'Test object',
  namePlural: 'Test objects',
  icon: null,
  iconColor: null,
  storage: 'table' as const,
  isStandard: false,
  isFirstClass: false,
  isGridCreateSupported: false,
  isHidden: false,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function attribute(overrides: Partial<AttributeDef>): AttributeDef {
  return {
    id: overrides.slug ?? 'attr',
    objectId: 'obj-1',
    slug: 'field',
    name: 'Field',
    description: null,
    icon: null,
    type: 'text',
    optionsJson: null,
    refObjectId: null,
    formatJson: null,
    validationJson: null,
    isIdentity: false,
    storage: 'column',
    isMulti: false,
    isRequired: false,
    isUnique: false,
    isReadOnly: false,
    isSystem: false,
    defaultJson: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const ATTRIBUTES: AttributeDef[] = [
  attribute({ slug: 'lastName', name: 'Last name', sortOrder: 1 }),
  attribute({ slug: 'firstName', name: 'First name', sortOrder: 0 }),
  attribute({ slug: 'notes', name: 'Notes', storage: 'list', sortOrder: 2 }),
]

beforeEach(() => {
  useRecordWindow.mockReset()
  mutateAsync.mockReset()
  mutateAsync.mockResolvedValue(undefined)
  createMutateAsync.mockReset()
  createMutateAsync.mockResolvedValue(undefined)
  useCreateRecord.mockReturnValue({ mutateAsync: createMutateAsync, isPending: false })
  dataEditorProps.current = null
  dataEditorScrollTo.mockReset()
  dataEditorProps.frozenRows = null
})

describe('RecordGrid', () => {
  it('does not render a create action when the server says grid creation is unsupported', () => {
    useRecordWindow.mockReturnValue({
      rows: [], totalCount: 0, isPending: false, isError: false, hasNextPage: false,
      isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    })
    const attributes = [attribute({ slug: 'status', name: 'Status' })]

    renderWithProviders(
      <RecordGrid
        orgId="org-1"
        object={{ ...TEST_OBJECT, slug: 'call', name: 'Call', namePlural: 'Calls' }}
        attributes={attributes}
        viewConfig={createViewConfig(attributes)}
        onViewConfigChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Create Call' })).not.toBeInTheDocument()
  })

  it('creates a new record from a blank grid row and closes it after the confirmed save', async () => {
    const user = userEvent.setup()
    useRecordWindow.mockReturnValue({
      rows: [], totalCount: 0, isPending: false, isError: false, hasNextPage: false,
      isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    })
    const object = { ...TEST_OBJECT, slug: 'company', name: 'Company', namePlural: 'Companies', isGridCreateSupported: true }
    const attributes = [attribute({ slug: 'name', name: 'Name', isIdentity: true })]

    renderWithProviders(
      <RecordGrid
        orgId="org-1"
        object={object}
        attributes={attributes}
        viewConfig={createViewConfig(attributes)}
        onViewConfigChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Create Company' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Acme')
    await user.click(screen.getByRole('button', { name: 'Save Company' }))

    expect(createMutateAsync).toHaveBeenCalledWith({
      orgId: 'org-1', object, values: { name: 'Acme' },
    })
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
  })

  it('shows a loading state before the first page resolves', () => {
    useRecordWindow.mockReturnValue({
      rows: [],
      totalCount: 0,
      isPending: true,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows a retry control on error', () => {
    useRecordWindow.mockReturnValue({
      rows: [],
      totalCount: 0,
      isPending: false,
      isError: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    expect(screen.getByText('Could not load these records.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('builds one column per readable attribute, ordered by sortOrder, and freezes the first', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada', lastName: 'Lovelace' }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    expect(screen.getByTestId('data-editor')).toBeInTheDocument()
    const props = dataEditorProps.current!
    const columns = props.columns as { id: string; title: string }[]

    // The list-storage attribute is not in the row payload, so it gets no column.
    expect(columns.map((c) => c.id)).toEqual(['firstName', 'lastName'])
    expect(props.freezeColumns).toBe(1)
    expect(props.rows).toBe(1)
  })

  it('uses the shared config to show ordered columns, widths, frozen rows, and frozen columns', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada', lastName: 'Lovelace' }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const config = {
      ...createViewConfig(ATTRIBUTES),
      columns: [
        { attributeId: 'lastName', visible: true, order: 0 },
        { attributeId: 'firstName', visible: false, order: 1 },
      ],
      columnWidths: { lastName: 280 },
      frozenRows: 2,
      frozenCols: 1,
      gridLines: false,
      rowHeight: 'comfortable' as const,
    }

    renderWithProviders(
      <RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} viewConfig={config} onViewConfigChange={vi.fn()} />,
    )

    const props = dataEditorProps.current!
    expect((props.columns as { id: string; width: number }[])).toEqual([
      expect.objectContaining({ id: 'lastName', width: 280 }),
    ])
    expect(props.freezeColumns).toBe(1)
    expect(props.rowHeight).toBe(44)
    expect(props.verticalBorder).toBe(false)
    expect((props.theme as { horizontalBorderColor: string }).horizontalBorderColor).toBe('transparent')
    expect(screen.getByTestId('frozen-rows-overlay')).toHaveAttribute('data-row-count', '2')
    expect(dataEditorProps.frozenRows).toMatchObject({ rows: 2, freezeColumns: 1, headerHeight: 0, scrollOffsetX: 0 })
  })

  it('writes column drag, resize, and selected-column resize through the shared config', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada', lastName: 'Lovelace' }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const onViewConfigChange = vi.fn()
    const config = createViewConfig(ATTRIBUTES)

    renderWithProviders(
      <RecordGrid
        orgId="org-1"
        object={TEST_OBJECT}
        attributes={ATTRIBUTES}
        viewConfig={config}
        onViewConfigChange={onViewConfigChange}
      />,
    )

    const props = dataEditorProps.current!
    const onColumnMoved = props.onColumnMoved as (start: number, end: number) => void
    onColumnMoved(0, 1)
    const moveUpdate = onViewConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(moveUpdate(config).columns).toEqual([
      { attributeId: 'lastName', visible: true, order: 0 },
      { attributeId: 'firstName', visible: true, order: 1 },
    ])

    act(() => {
      ;(props.onGridSelectionChange as (selection: unknown) => void)({
        current: undefined,
        columns: { items: [[0, 2]] },
        rows: { items: [] },
      })
    })
    const onColumnResize = dataEditorProps.current!.onColumnResize as (
      column: { id: string },
      width: number,
      index: number,
    ) => void
    onColumnResize({ id: 'firstName' }, 240, 0)
    const resizeUpdate = onViewConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    expect(resizeUpdate(config).columnWidths).toEqual({ firstName: 240, lastName: 240 })
  })

  it('keeps the frozen-row overlay horizontally synchronized with the scrolling grid', () => {
    useRecordWindow.mockReturnValue({
      rows: [
        { id: 'r1', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 'r2', firstName: 'Grace', lastName: 'Hopper' },
      ],
      totalCount: 2,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const config = { ...createViewConfig(ATTRIBUTES), frozenRows: 2, frozenCols: 2 }

    renderWithProviders(
      <RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} viewConfig={config} onViewConfigChange={vi.fn()} />,
    )

    act(() => {
      ;(dataEditorProps.current!.onVisibleRegionChanged as (range: { x: number; y: number; width: number; height: number }, tx: number) => void)(
        { x: 2, y: 2, width: 1, height: 1 },
        -40,
      )
    })

    expect(dataEditorProps.frozenRows).toMatchObject({ scrollOffsetX: 40, freezeColumns: 2 })
  })

  it('groups by any configured field with collapsible sections that show counts only', () => {
    useRecordWindow.mockReturnValue({
      rows: [
        { id: 'r1', firstName: 'Ada', lastName: 'Lovelace', status: 'open' },
        { id: 'r2', firstName: 'Grace', lastName: 'Hopper', status: 'closed' },
      ],
      totalCount: 2,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const groupedAttributes = [
      attribute({ slug: 'firstName', name: 'First name', sortOrder: 0 }),
      attribute({ slug: 'status', name: 'Status', sortOrder: 1, type: 'status', optionsJson: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] }),
    ]
    const config = { ...createViewConfig(groupedAttributes), groupBy: [{ attributeId: 'status', direction: 'asc' as const }] }

    renderWithProviders(
      <RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={groupedAttributes} viewConfig={config} onViewConfigChange={vi.fn()} />,
    )

    expect(dataEditorProps.current!.rows).toBe(4)
    const getCellContent = dataEditorProps.current!.getCellContent as (item: [number, number]) => { data: string }
    expect(getCellContent([0, 0]).data).toBe('▾ Open · 1')
    expect(getCellContent([0, 0]).data).not.toMatch(/sum|avg/i)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }))
    })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in grid' }), { target: { value: 'Ada' } })
    expect(dataEditorProps.current!.gridSelection).toMatchObject({ current: { cell: [0, 1] } })

    act(() => {
      ;(dataEditorProps.current!.onCellClicked as (item: [number, number]) => void)([0, 0])
    })
    expect(dataEditorProps.current!.rows).toBe(3)
  })

  it('reads a cell from the loaded row at that column and row index', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada', lastName: 'Lovelace' }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    const getCellContent = dataEditorProps.current!.getCellContent as (item: [number, number]) => unknown
    expect(getCellContent([0, 0])).toMatchObject({ data: 'Ada', readonly: false, allowOverlay: true })
    expect(getCellContent([1, 0])).toMatchObject({ data: 'Lovelace', readonly: false, allowOverlay: true })
  })

  it('round-trips a typed edit: the new value reads back on the next getCellContent call', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada', lastName: 'Lovelace' }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    const onCellEdited = dataEditorProps.current!.onCellEdited as (
      item: [number, number],
      newValue: Record<string, unknown>,
    ) => void

    act(() => {
      onCellEdited([0, 0], { kind: 'text', data: 'Grace', displayData: 'Grace', allowOverlay: true })
    })

    // Re-read the callback: onCellEdited's setState re-rendered RecordGrid,
    // so the closure the mock captured is a fresh one bound to the new value.
    const getCellContent = dataEditorProps.current!.getCellContent as (item: [number, number]) => Record<string, unknown>
    expect(getCellContent([0, 0])).toMatchObject({ data: 'Grace' })
  })

  it('coerces a pasted phone number to E.164 and flags an unparseable one instead of dropping it', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', phone: null }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    const phoneAttrs = [attribute({ slug: 'phone', name: 'Phone', type: 'phone', sortOrder: 0 })]
    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={phoneAttrs} />)

    const props = dataEditorProps.current!
    const validateCell = props.validateCell as (
      item: [number, number],
      newValue: Record<string, unknown>,
      prevValue: Record<string, unknown>,
    ) => Record<string, unknown>

    let valid!: Record<string, unknown>
    act(() => {
      valid = validateCell([0, 0], { kind: 'text', data: '+12025550123' }, { kind: 'text', data: '' })
    })
    expect(valid).toMatchObject({ data: '+12025550123' })
    expect(valid.themeOverride).toBeUndefined()

    let invalid!: Record<string, unknown>
    act(() => {
      invalid = validateCell([0, 0], { kind: 'text', data: 'not a phone' }, { kind: 'text', data: '' })
    })
    // Never dropped: the raw text survives, just flagged.
    expect(invalid).toMatchObject({ data: 'not a phone' })
    expect(invalid.themeOverride).toMatchObject({ textDark: '#dc2626' })
  })

  it('renders a select attribute as a chip Custom cell', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', status: 'open' }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    const statusAttrs = [
      attribute({
        slug: 'status',
        name: 'Status',
        type: 'status',
        sortOrder: 0,
        optionsJson: [{ value: 'open', label: 'Open' }],
      }),
    ]
    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={statusAttrs} />)

    const getCellContent = dataEditorProps.current!.getCellContent as (
      item: [number, number],
    ) => { kind: string; data: Record<string, unknown> }
    const cell = getCellContent([0, 0])
    expect(cell.kind).toBe('custom')
    expect(cell.data).toMatchObject({ kind: 'chip-cell', selectedValues: ['open'] })
  })

  it('requests the next window once the visible range nears the end of what is loaded', () => {
    const fetchNextPage = vi.fn()
    useRecordWindow.mockReturnValue({
      rows: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, firstName: 'A', lastName: 'B' })),
      totalCount: 500,
      isPending: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    const onVisibleRegionChanged = dataEditorProps.current!.onVisibleRegionChanged as (
      range: { x: number; y: number; width: number; height: number },
    ) => void

    // Far from the end of the 100 loaded rows: no fetch yet.
    onVisibleRegionChanged({ x: 0, y: 0, width: 5, height: 20 })
    expect(fetchNextPage).not.toHaveBeenCalled()

    // Within the prefetch margin of the end: fetch the next window.
    onVisibleRegionChanged({ x: 0, y: 60, width: 5, height: 20 })
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('Cmd-F finds loaded cells, selects the first match, and cycles with Enter', () => {
    useRecordWindow.mockReturnValue({
      rows: [
        { id: 'r1', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 'r2', firstName: 'Grace', lastName: 'Ada' },
      ],
      totalCount: 2,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    const find = screen.getByRole('searchbox', { name: 'Find in grid' })
    fireEvent.change(find, { target: { value: 'Ada' } })

    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(dataEditorProps.current!.gridSelection).toMatchObject({ current: { cell: [0, 0] } })

    fireEvent.keyDown(find, { key: 'Enter' })
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(dataEditorProps.current!.gridSelection).toMatchObject({ current: { cell: [1, 1] } })
    expect(dataEditorScrollTo).toHaveBeenLastCalledWith(1, 1, 'both', 0, 0, {
      hAlign: 'center',
      vAlign: 'center',
      behavior: 'smooth',
    })
  })

  it('Cmd-H exposes find and replace controls, then replaces every matching loaded cell', () => {
    useRecordWindow.mockReturnValue({
      rows: [
        { id: 'r1', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 'r2', firstName: 'Grace', lastName: 'Ada' },
      ],
      totalCount: 2,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    fireEvent.keyDown(document, { key: 'h', metaKey: true })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in grid' }), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'Grace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))

    const getCellContent = dataEditorProps.current!.getCellContent as (item: [number, number]) => Record<string, unknown>
    expect(getCellContent([0, 0])).toMatchObject({ data: 'Grace' })
    expect(getCellContent([1, 1])).toMatchObject({ data: 'Grace' })
    expect(screen.getByRole('checkbox', { name: 'Match case' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Whole cell' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Use regular expression' })).toBeInTheDocument()
  })

  it('applies match case, whole-cell, and regular-expression options to the finder', () => {
    useRecordWindow.mockReturnValue({
      rows: [
        { id: 'r1', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 'r2', firstName: 'ada', lastName: 'Byron' },
        { id: 'r3', firstName: 'Adam', lastName: 'Smith' },
      ],
      totalCount: 3,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })

    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

    fireEvent.keyDown(document, { key: 'h', metaKey: true })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in grid' }), { target: { value: 'Ada' } })
    expect(screen.getByText('1 of 3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Match case' }))
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Whole cell' }))
    expect(screen.getByText('1 of 1')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in grid' }), { target: { value: '[Aa]da' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use regular expression' }))
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('persists a typed edit and rolls it back when the write rejects', async () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada' }], totalCount: 1, isPending: false, isError: false,
      hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    })
    mutateAsync.mockRejectedValueOnce(new Error('forced'))
    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={[attribute({ slug: 'firstName' })]} />)
    const onCellEdited = dataEditorProps.current!.onCellEdited as (item: [number, number], cell: Record<string, unknown>) => void
    act(() => onCellEdited([0, 0], { kind: 'text', data: 'Grace' }))
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'r1', value: 'Grace' }))
    await act(async () => { await Promise.resolve() })
    const getCellContent = dataEditorProps.current!.getCellContent as (item: [number, number]) => Record<string, unknown>
    expect(getCellContent([0, 0])).toMatchObject({ data: 'Ada' })
  })

  it('persists a shared currency-editor commit and rolls it back when the write rejects', async () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', amount: 42.5 }], totalCount: 1, isPending: false, isError: false,
      hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    })
    mutateAsync.mockRejectedValueOnce(new Error('forced'))
    const amount = attribute({ slug: 'amount', name: 'Amount', type: 'currency' })
    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={[amount]} />)
    const getCellContent = dataEditorProps.current!.getCellContent as (item: [number, number]) => Record<string, unknown>
    const cell = getCellContent([0, 0])
    const onCellEdited = dataEditorProps.current!.onCellEdited as (item: [number, number], cell: Record<string, unknown>) => void
    act(() => onCellEdited([0, 0], { kind: 'custom', data: { ...(cell.data as Record<string, unknown>), value: 75.5 } }))
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'r1', value: 75.5 }))
    await act(async () => { await Promise.resolve() })
    expect(getCellContent([0, 0])).toMatchObject({ data: { value: 42.5 } })
  })

  it('persists undo through the same mutation path', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada' }], totalCount: 1, isPending: false, isError: false,
      hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    })
    renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={[attribute({ slug: 'firstName' })]} />)
    const onCellEdited = dataEditorProps.current!.onCellEdited as (item: [number, number], cell: Record<string, unknown>) => void
    act(() => onCellEdited([0, 0], { kind: 'text', data: 'Grace' }))
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })))
    const getCellContent = dataEditorProps.current!.getCellContent as (item: [number, number]) => Record<string, unknown>
    expect(getCellContent([0, 0])).toMatchObject({ data: 'Ada' })
    expect(mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'Ada' }))
  })

  describe('the peek drawer (MAI-167)', () => {
    function focusRow(row: number) {
      const onGridSelectionChange = dataEditorProps.current!.onGridSelectionChange as (
        selection: unknown,
      ) => void
      act(() => {
        onGridSelectionChange({
          current: { cell: [0, row], range: { x: 0, y: row, width: 1, height: 1 }, rangeStack: [] },
          columns: { items: [] },
          rows: { items: [] },
        })
      })
    }

    function press(key: string) {
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })
    }

    beforeEach(() => {
      useRecordWindow.mockReturnValue({
        rows: [
          { id: 'r1', firstName: 'Ada', lastName: 'Lovelace' },
          { id: 'r2', firstName: 'Grace', lastName: 'Hopper' },
        ],
        totalCount: 2,
        isPending: false,
        isError: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      })
    })

    it('Space does nothing with no row focused', () => {
      renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)
      press(' ')
      expect(screen.queryByRole('heading', { name: 'Ada' })).not.toBeInTheDocument()
    })

    it('Space opens the drawer for the focused row; j/k step without a refetch', () => {
      const fetchNextPage = vi.fn()
      useRecordWindow.mockReturnValue({
        rows: [
          { id: 'r1', firstName: 'Ada', lastName: 'Lovelace' },
          { id: 'r2', firstName: 'Grace', lastName: 'Hopper' },
        ],
        totalCount: 2,
        isPending: false,
        isError: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage,
        refetch: vi.fn(),
      })

      renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)

      focusRow(0)
      press(' ')
      expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()

      press('j')
      expect(screen.getByRole('heading', { name: 'Grace' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Ada' })).not.toBeInTheDocument()

      press('k')
      expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()

      // Stepping just re-indexes the already-loaded `rows` array — never a fetch.
      expect(fetchNextPage).not.toHaveBeenCalled()
    })

    it('edits a drawer field inline through the grid persistence path', () => {
      renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)
      focusRow(0)
      press(' ')
      fireEvent.click(screen.getByRole('button', { name: 'Lovelace' }))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Byron' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ value: 'Byron', recordId: 'r1' }))
    })

  it('j/k do nothing while the drawer is closed', () => {
      renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)
      focusRow(0)
      press('j')
      expect(screen.queryByRole('heading', { name: 'Ada' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Grace' })).not.toBeInTheDocument()
    })
  })

  it('opens a column-owned filter menu instead of changing sort on a header click', () => {
    useRecordWindow.mockReturnValue({
      rows: [{ id: 'r1', firstName: 'Ada', lastName: 'Lovelace' }],
      totalCount: 1,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const onViewConfigChange = vi.fn()
    const config = createViewConfig(ATTRIBUTES)

    renderWithProviders(
      <RecordGrid
        orgId="org-1"
        object={TEST_OBJECT}
        attributes={ATTRIBUTES}
        viewConfig={config}
        onViewConfigChange={onViewConfigChange}
      />,
    )

    const onHeaderMenuClick = dataEditorProps.current!.onHeaderMenuClick as (
      column: number,
      bounds: { x: number; y: number; width: number; height: number },
    ) => void
    act(() => {
      onHeaderMenuClick(0, { x: 16, y: 16, width: 220, height: 32 })
    })

    expect((dataEditorProps.current!.columns as { hasMenu?: boolean }[])[0]?.hasMenu).toBe(true)
    expect(screen.getByText('Filter First name')).toBeInTheDocument()
    expect(onViewConfigChange).not.toHaveBeenCalled()
  })
})
