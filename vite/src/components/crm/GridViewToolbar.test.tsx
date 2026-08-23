import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
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
  it('keeps sorting in the header and exposes the condition builder with compact labeled toolbar controls', () => {
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Sort' })).not.toBeInTheDocument()
    for (const name of ['Fields', 'Filter', 'Changes', 'Group', 'Row height', 'Freeze']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('turns on change highlights, selects the window, and keeps changed-row mode opt-in', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    const view = renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Changes' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Highlight changes' }))
    const enabledUpdate = onConfigChange.mock.calls[0][0] as (current: typeof config) => typeof config
    const enabledConfig = enabledUpdate(config)
    expect(enabledConfig.changeHighlight).toEqual({ mode: 'on', days: 7, onlyChangedRows: false })
    view.rerender(<GridViewToolbar attributes={attributes} config={enabledConfig} onConfigChange={onConfigChange} />)

    await user.click(screen.getByRole('button', { name: 'Changes' }))
    await user.click(await screen.findByText('Last 30 days'))
    const windowUpdate = onConfigChange.mock.calls[1][0] as (current: typeof config) => typeof config
    const windowConfig = windowUpdate(enabledConfig)
    expect(windowConfig.changeHighlight).toEqual({ mode: 'on', days: 30, onlyChangedRows: false })
    view.rerender(<GridViewToolbar attributes={attributes} config={windowConfig} onConfigChange={onConfigChange} />)

    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show only changed rows' }))
    const rowsUpdate = onConfigChange.mock.calls[2][0] as (current: typeof config) => typeof config
    expect(rowsUpdate(windowConfig).changeHighlight).toEqual({ mode: 'on', days: 30, onlyChangedRows: true })
  })

  it('accepts a bounded custom change window', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={onConfigChange} />)
    await user.click(screen.getByRole('button', { name: 'Changes' }))
    const input = await screen.findByRole('spinbutton', { name: 'Custom change window in days' })
    await user.clear(input)
    await user.type(input, '14')
    fireEvent.blur(input)

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

    await user.click(screen.getByRole('button', { name: 'Row height' }))
    await user.click(await screen.findByText('Comfortable'))
    const heightUpdate = onConfigChange.mock.calls[2][0] as (current: typeof config) => typeof config
    expect(heightUpdate(config).rowHeight).toBe('comfortable')

    await user.click(screen.getByRole('button', { name: 'Row height' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show grid lines' }))
    const linesUpdate = onConfigChange.mock.calls[3][0] as (current: typeof config) => typeof config
    expect(linesUpdate(config).gridLines).toBe(false)
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
