import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { renderWithProviders } from '@/test/utils'
import type { CalendarSource } from '@/lib/calendarTypes'
import { CalendarWorkspace_SchedulingFields } from './CalendarWorkspace_SchedulingFields'

const source: CalendarSource = {
  id: 'primary',
  provider: 'google',
  providerCalendarId: 'main',
  name: 'Family',
  description: null,
  timeZone: 'America/New_York',
  accessRole: 'owner',
  isPrimary: true,
  isSelected: true,
  lastSyncedAt: null,
  capabilities: { recurrence: true, rsvp: true, availability: true },
  recurrenceScopes: ['this-event', 'this-and-following', 'series'],
}

function renderSchedulingFields(overrides: Partial<ComponentProps<typeof CalendarWorkspace_SchedulingFields>> = {}) {
  const props: ComponentProps<typeof CalendarWorkspace_SchedulingFields> = {
    orgId: 'org-1',
    source,
    date: new Date(2026, 8, 3),
    timeZone: 'America/New_York',
    durationMinutes: 30,
    guestEmails: '',
    repeatMode: 'none',
    recurrenceRule: '',
    onGuestEmailsChange: vi.fn(),
    onRepeatChange: vi.fn(),
    onRecurrenceRuleChange: vi.fn(),
    onChooseTime: vi.fn(),
    ...overrides,
  }
  return { ...renderWithProviders(<CalendarWorkspace_SchedulingFields {...props} />), props }
}

describe('CalendarWorkspace_SchedulingFields repeat row', () => {
  it('shows date-derived presets and commits the chosen full rule sentence', async () => {
    const user = userEvent.setup()
    const onRepeatChange = vi.fn()
    renderSchedulingFields({ onRepeatChange })

    const row = screen.getByRole('combobox', { name: 'Does not repeat' })
    expect(row).toHaveAttribute('aria-haspopup', 'listbox')
    expect(row).toHaveAttribute('aria-expanded', 'false')

    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Does not repeat',
      'Daily',
      'Weekly on Thursday',
      'Monthly on the first Thursday',
      'Yearly',
      'Custom',
    ])
    await user.click(screen.getByRole('option', { name: 'Weekly on Thursday' }))

    expect(onRepeatChange).toHaveBeenCalledWith('weekly', 'RRULE:FREQ=WEEKLY;BYDAY=TH')
  })

  it('recomputes preset labels after a move without changing the saved rule', async () => {
    const user = userEvent.setup()
    const onRepeatChange = vi.fn()
    renderSchedulingFields({
      date: new Date(2026, 8, 4),
      repeatMode: 'weekly',
      recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=TH',
      onRepeatChange,
    })

    const row = screen.getByRole('combobox', { name: 'Weekly on Thursday' })
    expect(row).toHaveTextContent('Weekly on Thursday')
    await user.click(row)
    expect(screen.getByRole('option', { name: 'Weekly on Friday' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(row).toHaveFocus()
    expect(onRepeatChange).not.toHaveBeenCalled()
  })

  it('commits with Enter and discards with Escape', async () => {
    const user = userEvent.setup()
    const onRepeatChange = vi.fn()
    renderSchedulingFields({ onRepeatChange })

    const row = screen.getByRole('combobox', { name: 'Does not repeat' })
    await user.click(row)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onRepeatChange).toHaveBeenCalledWith('daily', 'RRULE:FREQ=DAILY')

    onRepeatChange.mockClear()
    await user.click(row)
    await user.keyboard('{ArrowDown}{Escape}')
    expect(onRepeatChange).not.toHaveBeenCalled()
    expect(row).toHaveFocus()
  })

  it('renders a read-only calendar rule as static text with the editability reason', () => {
    renderSchedulingFields({
      source: { ...source, accessRole: 'reader' },
      repeatMode: 'weekly',
      recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=TH',
    })

    expect(screen.getByText('Weekly on Thursday')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Weekly on Thursday' })).not.toBeInTheDocument()
    expect(screen.getByText('This calendar cannot be edited here.')).toBeInTheDocument()
  })

  it("keeps the provider's rejection directly under the unchanged rule", () => {
    renderSchedulingFields({
      repeatMode: 'weekly',
      recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261123',
      repeatError: 'This calendar only allows repeats through Nov 1, 2026.',
    })

    expect(screen.getByRole('combobox', { name: 'Weekly on Thursday, until Nov 23, 2026' })).toBeInTheDocument()
    expect(screen.getByText('This calendar only allows repeats through Nov 1, 2026.')).toBeInTheDocument()
  })
})
