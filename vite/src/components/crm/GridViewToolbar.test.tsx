import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
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
  it('keeps sort and column filtering in the header while exposing compact labeled toolbar controls', () => {
    const config = createViewConfig(attributes)

    renderWithProviders(<GridViewToolbar attributes={attributes} config={config} onConfigChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Sort' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument()
    for (const name of ['Fields', 'Group', 'Row height', 'Freeze']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
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
