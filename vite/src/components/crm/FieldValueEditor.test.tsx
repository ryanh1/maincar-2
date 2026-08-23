import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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

  it('commits a currency value as a number', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Amount', type: 'currency' })} value={42} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Amount' })
    fireEvent.change(input, { target: { value: '123.45' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(123.45)
  })

  it('edits a deal amount in major units while preserving minor-unit storage', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ slug: 'amountMinor', name: 'Amount', type: 'currency' })} value="12345" timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(input).toHaveValue('123.45')
    fireEvent.change(input, { target: { value: '500.05' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(50005)
  })

  it('uses numeric formatting for number and rating fields', () => {
    const { rerender } = render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Headcount', type: 'number' })} value={1200} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Headcount' })
    expect(input).toHaveValue('1,200')
    fireEvent.change(input, { target: { value: '2,500.5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(2500.5)

    rerender(<FieldValueEditor key="rating" orgId="org-1" attribute={attribute({ name: 'Score', type: 'rating' })} value={4} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Score' })).toHaveValue('4')
  })

  it('commits text and a selected option with their stored values', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Notes', type: 'text' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const text = screen.getByRole('textbox', { name: 'Notes' })
    await user.type(text, 'Follow up Friday')
    await user.keyboard('{Enter}')
    expect(onCommit).toHaveBeenCalledWith('Follow up Friday')

    rerender(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Stage', type: 'select', optionsJson: [{ value: 'qualified', label: 'Qualified' }] })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('combobox', { name: 'Stage' }))
    await user.click(screen.getByRole('option', { name: 'Qualified' }))
    expect(onCommit).toHaveBeenLastCalledWith('qualified')
  })

  it('commits a date-only value without converting it through a timestamp', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Renewal date', type: 'date' })} value="2026-08-24" timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Renewal date' }))
    fireEvent.click(screen.getByRole('button', { name: /August 25th, 2026/ }))
    expect(onCommit).toHaveBeenCalledWith('2026-08-25')
  })

  it('parses an @date command into the real calendar date value', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Renewal date', type: 'date' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Set Renewal date with @date' })
    fireEvent.change(input, { target: { value: '@date tomorrow' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })

  it('opens the status field’s own valid-options dropdown when @ is pressed', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Stage', type: 'status', optionsJson: [{ value: 'open', label: 'Open' }] })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Stage' }), { key: '@' })

    expect(screen.getByRole('option', { name: 'Open' })).toBeInTheDocument()
  })

  it('uses the date picker to commit a timestamp in the viewer time zone', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Scheduled at', type: 'timestamp' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Scheduled at' }))
    fireEvent.click(screen.getByRole('button', { name: /August 25th, 2026/ }))
    fireEvent.change(screen.getByLabelText('Scheduled at time (EDT)'), { target: { value: '15:30' } })
    fireEvent.keyDown(screen.getByLabelText('Scheduled at time (EDT)'), { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith('2026-08-25T19:30:00.000Z')
  })

  it('uses a checkbox for boolean fields', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Qualified', type: 'checkbox' })} value={false} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Qualified' }))
    expect(onCommit).toHaveBeenCalledWith(true)
  })

  it('normalizes a phone number and website before committing', () => {
    const { rerender } = render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Phone', type: 'phone' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    const phone = screen.getByRole('textbox', { name: 'Phone' })
    fireEvent.change(phone, { target: { value: '+1 202 555 0123' } })
    fireEvent.keyDown(phone, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('+12025550123')

    rerender(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Website', type: 'url' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)
    const website = screen.getByRole('textbox', { name: 'Website' })
    fireEvent.change(website, { target: { value: 'EXAMPLE.com/path' } })
    fireEvent.keyDown(website, { key: 'Enter' })
    expect(onCommit).toHaveBeenLastCalledWith('https://example.com/path')

    rerender(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Email', type: 'email' })} value={null} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)
    const email = screen.getByRole('textbox', { name: 'Email' })
    fireEvent.change(email, { target: { value: 'not an email' } })
    fireEvent.keyDown(email, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid email address')
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

  it('commits each multiselect change without a separate save action', () => {
    render(<FieldValueEditor orgId="org-1" attribute={attribute({ name: 'Stage', type: 'multiselect', isMulti: true, optionsJson: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }] })} value={['new']} timeZone="America/New_York" onCommit={onCommit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Won' }))
    expect(onCommit).toHaveBeenCalledWith(['new', 'won'])
    expect(screen.queryByRole('button', { name: 'Save Stage' })).not.toBeInTheDocument()
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
