import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'

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
    onChooseTime: vi.fn(),
    ...overrides,
  }
  return { ...renderWithProviders(<CalendarWorkspace_SchedulingFields {...props} />), props }
}

function ControlledSchedulingFields({ initialRule = '' }: { initialRule?: string }) {
  const [repeatMode, setRepeatMode] = useState<ComponentProps<typeof CalendarWorkspace_SchedulingFields>['repeatMode']>(initialRule ? 'custom' : 'none')
  const [recurrenceRule, setRecurrenceRule] = useState(initialRule)
  return (
    <CalendarWorkspace_SchedulingFields
      orgId="org-1"
      source={source}
      date={new Date(2026, 8, 3)}
      timeZone="America/New_York"
      durationMinutes={30}
      guestEmails=""
      repeatMode={repeatMode}
      recurrenceRule={recurrenceRule}
      onGuestEmailsChange={vi.fn()}
      onRepeatChange={(nextMode, nextRule) => {
        setRepeatMode(nextMode)
        setRecurrenceRule(nextRule)
      }}
      onChooseTime={vi.fn()}
    />
  )
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

  it('builds, validates, saves and reopens a custom weekly rule', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ControlledSchedulingFields />)

    const repeatRow = screen.getByRole('combobox', { name: 'Does not repeat' })
    await user.click(repeatRow)
    await user.click(screen.getByRole('option', { name: 'Custom' }))

    expect(screen.getByRole('dialog', { name: 'Custom repeat' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Repeat interval' })).toHaveValue(1)
    expect(screen.getByRole('combobox', { name: 'Repeat frequency' })).toHaveTextContent('week')
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: 'Never' })).toHaveAttribute('data-state', 'checked')
    expect(screen.getByText('Weekly on Thursday')).toHaveAttribute('aria-live', 'polite')

    const interval = screen.getByRole('spinbutton', { name: 'Repeat interval' })
    await user.clear(interval)
    expect(interval).toHaveValue(null)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a number from 1 to 999.')
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    await user.type(interval, '2')
    await user.click(screen.getByRole('button', { name: 'Tuesday' }))
    await user.click(screen.getByRole('radio', { name: 'After' }))
    const count = screen.getByRole('spinbutton', { name: 'Number of occurrences' })
    await user.clear(count)
    await user.type(count, '1000')
    expect(count).toHaveValue(1000)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose 1 to 999 times.')
    await user.clear(count)
    await user.type(count, '13')
    expect(screen.getByText('Every 2 weeks on Tuesday, Thursday, 13 times')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tuesday' }))
    await user.click(screen.getByRole('button', { name: 'Thursday' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one weekday.')
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Tuesday' }))
    await user.click(screen.getByRole('button', { name: 'Thursday' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Custom repeat' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Every 2 weeks on Tuesday, Thursday, 13 times' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Every 2 weeks on Tuesday, Thursday, 13 times' }))
    await user.click(screen.getByRole('option', { name: 'Custom' }))
    expect(screen.getByRole('spinbutton', { name: 'Repeat interval' })).toHaveValue(2)
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('spinbutton', { name: 'Number of occurrences' })).toHaveValue(13)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('combobox', { name: 'Every 2 weeks on Tuesday, Thursday, 13 times' })).toHaveFocus()
  })

  it('keeps weekly choices in the draft and uses the shared picker for an end date', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ControlledSchedulingFields />)

    await user.click(screen.getByRole('combobox', { name: 'Does not repeat' }))
    await user.click(screen.getByRole('option', { name: 'Custom' }))
    await user.click(screen.getByRole('button', { name: 'Tuesday' }))
    await user.click(screen.getByRole('combobox', { name: 'Repeat frequency' }))
    await user.click(screen.getByRole('option', { name: 'month' }))
    expect(screen.getByRole('radio', { name: 'Day 3 of the month' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'The first Thursday' })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Repeat frequency' }))
    await user.click(screen.getByRole('option', { name: 'week' }))
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('radio', { name: 'On' }))
    expect(screen.getByRole('button', { name: 'Repeat until' })).toBeInTheDocument()
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument()

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    await user.click(overlay as HTMLElement)
    expect(screen.getByRole('dialog', { name: 'Custom repeat' })).toBeInTheDocument()
  })
})
