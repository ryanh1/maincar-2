import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'

const { useGetTeamsMock, useGetMembersMock } = vi.hoisted(() => ({
  useGetTeamsMock: vi.fn(),
  useGetMembersMock: vi.fn(),
}))

vi.mock('@/hooks/orgs', () => ({
  memberDisplayName: (member: { firstName: string | null; lastName: string | null; email: string }) =>
    [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
  useGetTeams: useGetTeamsMock,
  useGetMembers: useGetMembersMock,
}))

import { GridViewToolbar } from './GridViewToolbar'
import { createViewConfig } from './viewConfig'

const attributes = [
  {
    id: 'status',
    objectId: 'object-1',
    slug: 'status',
    name: 'Status',
    description: null,
    icon: null,
    type: 'status',
    optionsJson: [{ value: 'open', label: 'Open' }],
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
  },
] satisfies AttributeDef[]

describe('GridViewToolbar', () => {
  beforeEach(() => {
    useGetTeamsMock.mockReturnValue({ data: { teams: [{ id: 'team-revenue', name: 'Revenue' }] }, isPending: false })
    useGetMembersMock.mockReturnValue({
      data: { members: [{ userId: 'user-jordan', firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.test' }] },
      isPending: false,
    })
  })
  it('separates stable view controls from task commands and structured view options', async () => {
    const user = userEvent.setup()
    const config = createViewConfig(attributes)
    const onSearch = vi.fn()
    const onFormat = vi.fn()

    renderWithProviders(
      <GridViewToolbar
        leading={<button type="button">Saved view</button>}
        trailing={<output>42 records</output>}
        attributes={attributes}
        config={config}
        onConfigChange={vi.fn()}
        onLayoutChange={vi.fn()}
        onSearch={onSearch}
        onFormat={onFormat}
      />,
    )

    const viewBar = screen.getByRole('region', { name: 'View bar' })
    expect(within(viewBar).getByRole('button', { name: 'Saved view' })).toBeInTheDocument()
    expect(within(viewBar).getByRole('button', { name: 'Table' })).toBeInTheDocument()
    expect(within(viewBar).getByRole('button', { name: 'Kanban' })).toBeInTheDocument()
    expect(within(viewBar).getByText('42 records')).toBeInTheDocument()

    const commandBar = screen.getByRole('region', { name: 'Command bar' })
    for (const name of ['Search', 'Fields', 'Sort', 'Filter', 'Group', 'View options']) {
      expect(within(commandBar).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(commandBar).queryByRole('button', { name: 'Table' })).not.toBeInTheDocument()

    await user.click(within(commandBar).getByRole('button', { name: 'Search' }))
    expect(onSearch).toHaveBeenCalledOnce()

    await user.click(within(commandBar).getByRole('button', { name: 'View options' }))
    for (const name of ['Format', 'Change highlighting', 'Density', 'Freeze', 'Zoom']) {
      expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('menuitem', { name: 'Format' }))
    expect(onFormat).toHaveBeenCalledOnce()
  })

  it('turns on change highlights, selects the window, and keeps changed-row mode opt-in', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    const view = renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'View options' }))
    ;(await screen.findByRole('menuitem', { name: 'Change highlighting' })).focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Highlight changes' }))
    const enabledUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    const enabledConfig = enabledUpdate(config)
    expect(enabledConfig.changeHighlight).toEqual({ mode: 'on', days: 7, onlyChangedRows: false })
    view.rerender(<GridViewToolbar attributes={attributes} config={enabledConfig} onConfigChange={onConfigChange} />)

    await user.keyboard('{Escape}{Escape}')
    await user.click(screen.getByRole('button', { name: 'View options' }))
    ;(await screen.findByRole('menuitem', { name: 'Change highlighting' })).focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByText('Last 30 days'))
    const windowUpdate = onConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    const windowConfig = windowUpdate(enabledConfig)
    expect(windowConfig.changeHighlight).toEqual({ mode: 'on', days: 30, onlyChangedRows: false })
    view.rerender(<GridViewToolbar attributes={attributes} config={windowConfig} onConfigChange={onConfigChange} />)

    await user.keyboard('{Escape}{Escape}')
    await user.click(screen.getByRole('button', { name: 'View options' }))
    ;(await screen.findByRole('menuitem', { name: 'Change highlighting' })).focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show only changed rows' }))
    const rowsUpdate = onConfigChange.mock.calls[2][0] as (current: typeof config) => typeof config
    expect(rowsUpdate(windowConfig).changeHighlight).toEqual({ mode: 'on', days: 30, onlyChangedRows: true })
  })

  it('accepts a bounded custom change window', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} />)
    await user.click(screen.getByRole('button', { name: 'View options' }))
    ;(await screen.findByRole('menuitem', { name: 'Change highlighting' })).focus()
    await user.keyboard('{ArrowRight}')
    const input = await screen.findByRole('spinbutton', { name: 'Custom change window in days' })
    await user.clear(input)
    await user.type(input, '14')
    await user.keyboard('{Enter}')

    const customWindowUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(customWindowUpdate(config).changeHighlight.days).toBe(14)
  })

  it('writes field visibility, grouping, row height, and grid lines through the shared config', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Fields' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Status' }))
    const visibilityUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(visibilityUpdate(config).columns).toEqual([{ attributeId: 'status', visible: false, order: 0 }])
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Group' }))
    await user.click(await screen.findByText('Group by Status'))
    const groupUpdate = onConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    expect(groupUpdate(config).groupBy).toEqual([{ attributeId: 'status', direction: 'asc' }])

    await user.click(screen.getByRole('button', { name: 'View options' }))
    ;(await screen.findByRole('menuitem', { name: 'Density' })).focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitemradio', { name: 'Comfortable' }))
    const heightUpdate = onConfigChange.mock.calls[2][0] as (current: typeof config) => typeof config
    expect(heightUpdate(config).rowHeight).toBe('comfortable')

    await user.keyboard('{Escape}{Escape}')
    await user.click(screen.getByRole('button', { name: 'View options' }))
    ;(await screen.findByRole('menuitem', { name: 'Density' })).focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show grid lines' }))
    const linesUpdate = onConfigChange.mock.calls[3][0] as (current: typeof config) => typeof config
    expect(linesUpdate(config).gridLines).toBe(true)
  })

  it('reconfigures a Kanban board from valid option metadata instead of grid grouping', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} layout="kanban" />)

    await user.click(screen.getByRole('button', { name: 'Group' }))
    await user.click(await screen.findByText('Group by Status'))

    const update = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(update(config)).toEqual(expect.objectContaining({
      groupBy: [],
      kanban: { groupAttributeId: 'status', visibleOptionValues: ['open'], cardAttributeIds: [] },
    }))
  })

  it('shows board controls without grid-only field, formatting, row, or freeze controls', () => {
    const config = {
      ...createViewConfig(attributes),
      kanban: { groupAttributeId: 'status', visibleOptionValues: ['open'], cardAttributeIds: [] },
    }

    renderWithProviders(
      <GridViewToolbar
        attributes={attributes}
        config={config}
        layout="kanban"
        onConfigChange={vi.fn()}
        onFormat={vi.fn()}
        selectedColumnIds={['status', 'owner']}
      />,
    )

    for (const name of ['Sort', 'Filter', 'Group · 1', 'Card fields']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['Fields', 'Format', 'Changes', 'Group columns', 'Row height', 'Show grid lines', 'Freeze', 'View options']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('textbox', { name: 'Column group name' })).not.toBeInTheDocument()
  })

  it('names a group for adjacent selected columns through the shared config', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const owner = { ...attributes[0], id: 'owner', slug: 'owner', name: 'Owner', sortOrder: 1 }
    const groupedAttributes = [...attributes, owner]
    const config = createViewConfig(groupedAttributes)

    renderWithProviders(
      <GridViewToolbar
        attributes={groupedAttributes}
        config={config}
        onConfigChange={onConfigChange}
        selectedColumnIds={['status', 'owner']}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Column group name' }), 'Pipeline')
    await user.click(screen.getByRole('button', { name: 'Group columns' }))

    const groupUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(groupUpdate(config).columns).toEqual([
      { attributeId: 'status', visible: true, order: 0, group: 'Pipeline', collapsed: false },
      { attributeId: 'owner', visible: true, order: 1, group: 'Pipeline', collapsed: false },
    ])
  })

  it('shows the Team scope control only for owner-backed grids', async () => {
    const user = userEvent.setup()
    const config = createViewConfig(attributes)

    const { unmount } = renderWithProviders(
      <GridViewToolbar
        orgId="org-1"
        attributes={attributes}
        config={config}
        onConfigChange={vi.fn()}
        teamScopeSupported
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Team' }))
    expect(await screen.findByText('Specific teams')).toBeInTheDocument()
    expect(await screen.findByText('Teams led by')).toBeInTheDocument()

    unmount()
    renderWithProviders(<GridViewToolbar orgId="org-1" attributes={attributes} config={config} onConfigChange={vi.fn()} teamScopeSupported={false} />)
    expect(screen.queryByRole('button', { name: 'Team' })).not.toBeInTheDocument()
  })

  it('writes selected teams and direct team leads into the reusable scope without expanding a roster', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar orgId="org-1" attributes={attributes} config={config} onConfigChange={onConfigChange} teamScopeSupported />)

    await user.click(screen.getByRole('button', { name: 'Team' }))
    const revenue = await screen.findByRole('menuitemcheckbox', { name: 'Revenue' })
    revenue.focus()
    await user.keyboard(' ')
    const teamUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    expect(teamUpdate(config).teamScope).toEqual({ teamIds: ['team-revenue'] })

    const jordan = await screen.findByRole('menuitemcheckbox', { name: 'Jordan Lee' })
    jordan.focus()
    await user.keyboard(' ')
    const leadUpdate = onConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    expect(leadUpdate(config).teamScope).toEqual({ leadUserIds: ['user-jordan'] })
  })
})
