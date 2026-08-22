/**
 * The canvas Glide draws to isn't available in jsdom, so `DataEditor` itself is
 * mocked out — this test is about the WIRING this component does around it
 * (which columns it builds, freezing the leading one, what it renders while
 * loading/erroring/empty), not about canvas rendering. Real rendering and 60fps
 * scroll are verified in the browser (CLAUDE.md → Verification before finishing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import { RecordGrid } from './RecordGrid'
import { createViewConfig } from './viewConfig'

const useRecordWindow = vi.hoisted(() => vi.fn())
const useGetActivity = vi.hoisted(() => vi.fn(() => ({ isPending: false, isError: false, data: undefined })))
vi.mock('@/hooks/crm', () => ({ useRecordWindow, useGetActivity }))

vi.mock('@/providers/useAuth', () => ({
  useAuth: () => ({ user: { timeZone: 'America/New_York' } }),
}))

// The real module pulls in canvas rendering internals jsdom cannot run, and this
// test is about RecordGrid's own wiring (columns, freezing, cell lookup,
// prefetch) rather than canvas drawing — so the whole module is replaced, not
// partially mocked over the real one.
const dataEditorProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('@glideapps/glide-data-grid', () => ({
  DataEditor: (props: Record<string, unknown>) => {
    dataEditorProps.current = props
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
  dataEditorProps.current = null
})

describe('RecordGrid', () => {
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

  it('j/k do nothing while the drawer is closed', () => {
      renderWithProviders(<RecordGrid orgId="org-1" object={TEST_OBJECT} attributes={ATTRIBUTES} />)
      focusRow(0)
      press('j')
      expect(screen.queryByRole('heading', { name: 'Ada' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Grace' })).not.toBeInTheDocument()
    })
  })

  it('updates the shared view config when a column header is clicked', () => {
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

    const onHeaderClicked = dataEditorProps.current!.onHeaderClicked as (column: number) => void
    onHeaderClicked(0)

    const update = onViewConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config).sorts).toEqual([{ attributeId: 'firstName', direction: 'asc' }])
  })
})
