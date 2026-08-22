import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { AttributeDef } from '@/lib/crmTypes'
import { FieldValueEditor } from './FieldValueEditor'

const useGetObject = vi.hoisted(() => vi.fn())
const useListRecords = vi.hoisted(() => vi.fn())
const useGetMembers = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/crm', () => ({ useGetObject, useListRecords }))
vi.mock('@/hooks/orgs', () => ({ useGetMembers, memberDisplayName: (member: { firstName: string | null; lastName: string | null; email: string }) => [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email }))

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

describe('FieldValueEditor', () => {
  const onCommit = vi.fn()

  beforeEach(() => {
    onCommit.mockReset()
    useGetObject.mockReturnValue({ data: undefined, isPending: false })
    useListRecords.mockReturnValue({ data: undefined, isPending: false })
    useGetMembers.mockReturnValue({ data: { members: [] }, isPending: false })
  })

  it('commits a currency value as a number and retains invalid input with an actionable reason', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Amount', type: 'currency' })} value={42} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Amount' })
    fireEvent.change(input, { target: { value: '123.45' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(123.45)

    fireEvent.change(input, { target: { value: 'not money' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid amount.')
    expect(input).toHaveValue('not money')
  })

  it('edits a deal amount in major units while preserving minor-unit storage', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ slug: 'amountMinor', name: 'Amount', type: 'currency' })} value="12345" timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(input).toHaveValue('123.45')
    fireEvent.change(input, { target: { value: '500.05' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(50005)
  })

  it('commits a date-only value without converting it through a timestamp', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Renewal date', type: 'date' })} value="2026-08-24" timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Renewal date' }))
    fireEvent.click(screen.getByRole('button', { name: /August 25th, 2026/ }))
    expect(onCommit).toHaveBeenCalledWith('2026-08-25')
  })

  it('commits a timestamp as an explicit UTC ISO value', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Scheduled at', type: 'timestamp' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Scheduled at (UTC)' })
    expect(input).toHaveAttribute('placeholder', 'YYYY-MM-DDTHH:MM:SSZ (UTC)')
    fireEvent.change(input, { target: { value: '2026-08-25T15:30:00Z' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith('2026-08-25T15:30:00.000Z')
  })

  it('cancels a typed edit with Escape without committing the draft', () => {
    const onCancel = vi.fn()
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Amount', type: 'currency' })} value={42} timeZone="America/New_York" onCommit={onCommit} onCancel={onCancel} />)

    const input = screen.getByRole('textbox', { name: 'Amount' })
    fireEvent.change(input, { target: { value: '123.45' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('uses option controls for a multiselect field', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Stage', type: 'multiselect', isMulti: true, optionsJson: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }] })} value={['new']} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Won' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Stage' }))
    expect(onCommit).toHaveBeenCalledWith(['new', 'won'])
  })

  it('uses record and member pickers for reference fields', () => {
    useGetObject.mockReturnValue({
      data: { object: { id: 'companies', attributes: [attribute({ slug: 'name', name: 'Name', isIdentity: true })] } },
      isPending: false,
    })
    useListRecords.mockReturnValue({
      data: { pages: [{ rows: [{ id: 'company-1', name: 'Acme' }] }] },
      isPending: false,
    })
    useGetMembers.mockReturnValue({
      data: { members: [{ userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }] },
      isPending: false,
    })

    const { rerender } = render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Company', type: 'record_reference', refObjectId: 'companies' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('option', { name: 'Acme' }))
    expect(onCommit).toHaveBeenCalledWith('company-1')

    rerender(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Owner', type: 'user_reference' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    expect(onCommit).toHaveBeenLastCalledWith('user-1')
  })
})
