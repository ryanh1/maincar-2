import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { RecipientChip } from '@/lib/emailTypes'
import { RecipientField } from './ComposerCard_Recipients'

function typedChip(address: string): RecipientChip {
  return { address, displayName: null, recordId: null }
}

/**
 * The field is controlled, so the tests need something to control it.
 *
 * State lives here rather than in the component on purpose: what these tests
 * have to prove is which list the field hands **upward**, because that list is
 * what the draft autosaves.
 */
function Harness({ initial = [] as RecipientChip[] }) {
  const [chips, setChips] = useState<RecipientChip[]>(initial)
  return (
    <div>
      <RecipientField label="To" chips={chips} onChange={setChips} />
      {/* Somewhere else to put the focus, for the Tab and blur tests. */}
      <button type="button">Elsewhere</button>
    </div>
  )
}

function renderField(initial: RecipientChip[] = []) {
  const user = userEvent.setup()
  render(<Harness initial={initial} />)
  return { user, box: screen.getByLabelText('To') as HTMLInputElement }
}

/** Every chip on screen, in order, by the address its own `✕` names. */
function chipAddresses(): string[] {
  return screen
    .getAllByRole('button', { name: /^Remove / })
    .map((button) => button.getAttribute('aria-label')!.replace(/^Remove /, ''))
}

describe('RecipientField', () => {
  describe('committing what was typed', () => {
    it('turns the text into a chip on Enter and empties the box', async () => {
      const { user, box } = renderField()

      await user.type(box, 'ann@acme.com{Enter}')

      expect(chipAddresses()).toEqual(['ann@acme.com'])
      expect(box).toHaveValue('')
    })

    it('commits on a comma, and the comma never reaches the box', async () => {
      const { user, box } = renderField()

      await user.type(box, 'ann@acme.com,')

      expect(chipAddresses()).toEqual(['ann@acme.com'])
      expect(box).toHaveValue('')
    })

    it('commits on Tab', async () => {
      const { user, box } = renderField()

      await user.type(box, 'ann@acme.com')
      await user.keyboard('{Tab}')

      expect(chipAddresses()).toEqual(['ann@acme.com'])
      expect(box).toHaveValue('')
    })

    it('commits on blur rather than throwing the text away', async () => {
      const { user, box } = renderField()

      await user.type(box, 'ann@acme.com')
      await user.click(screen.getByRole('button', { name: 'Elsewhere' }))

      expect(chipAddresses()).toEqual(['ann@acme.com'])
      expect(box).toHaveValue('')
    })

    it('adds nothing when Enter lands on an empty box', async () => {
      const { user, box } = renderField()

      await user.click(box)
      await user.keyboard('{Enter}')

      expect(screen.queryAllByRole('button', { name: /^Remove / })).toHaveLength(0)
    })

    it('adds nothing when the box holds only spaces', async () => {
      const { user, box } = renderField()

      await user.type(box, '   {Enter}')

      expect(screen.queryAllByRole('button', { name: /^Remove / })).toHaveLength(0)
    })

    it('leaves Tab alone on an empty box, so focus moves on', async () => {
      const { user, box } = renderField()

      await user.click(box)
      await user.keyboard('{Tab}')

      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
    })

    it('adds one chip for the same address typed twice in different case', async () => {
      const { user, box } = renderField()

      await user.type(box, 'Ann@Acme.com{Enter}')
      await user.type(box, 'ann@acme.com{Enter}')

      expect(chipAddresses()).toEqual(['Ann@Acme.com'])
    })

    it('addresses five people and drops one, keyboard alone', async () => {
      // The module's success criterion, written as a test
      // (SPEC-composer-recipients.md → Success criteria).
      const { user, box } = renderField()

      await user.type(box, 'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com{Enter}')
      expect(chipAddresses()).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'])

      await user.keyboard('{Backspace}')
      expect(chipAddresses()).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'])
    })
  })

  describe('Backspace', () => {
    it('deletes the WHOLE last chip when the box is empty', async () => {
      const { user, box } = renderField([typedChip('ann@acme.com'), typedChip('bo@acme.com')])

      await user.click(box)
      await user.keyboard('{Backspace}')

      // The whole person is gone. Not `bo@acme.co`.
      expect(chipAddresses()).toEqual(['ann@acme.com'])
      expect(box).toHaveValue('')
    })

    it('edits the text instead when the box is not empty', async () => {
      const { user, box } = renderField([typedChip('ann@acme.com')])

      await user.type(box, 'bo@acme.com')
      await user.keyboard('{Backspace}')

      expect(box).toHaveValue('bo@acme.co')
      expect(chipAddresses()).toEqual(['ann@acme.com'])
    })

    it('does nothing on an empty box with no chips', async () => {
      const { user, box } = renderField()

      await user.click(box)
      await user.keyboard('{Backspace}')

      expect(screen.queryAllByRole('button', { name: /^Remove / })).toHaveLength(0)
      expect(box).toHaveValue('')
    })

    it('removes chips one at a time, right to left', async () => {
      const { user, box } = renderField([
        typedChip('a@x.com'),
        typedChip('b@x.com'),
        typedChip('c@x.com'),
      ])

      await user.click(box)
      await user.keyboard('{Backspace}{Backspace}')

      expect(chipAddresses()).toEqual(['a@x.com'])
    })
  })

  describe('the ✕ on a chip', () => {
    it('is labelled with the address it removes', () => {
      renderField([typedChip('ann@acme.com')])

      expect(screen.getByRole('button', { name: 'Remove ann@acme.com' })).toBeInTheDocument()
    })

    it('removes only that chip', async () => {
      const { user } = renderField([
        typedChip('a@x.com'),
        typedChip('b@x.com'),
        typedChip('c@x.com'),
      ])

      await user.click(screen.getByRole('button', { name: 'Remove b@x.com' }))

      expect(chipAddresses()).toEqual(['a@x.com', 'c@x.com'])
    })

    it('puts the focus back in the box, so the keyboard never leaves the field', async () => {
      const { user, box } = renderField([typedChip('a@x.com'), typedChip('b@x.com')])

      await user.click(screen.getByRole('button', { name: 'Remove a@x.com' }))

      expect(box).toHaveFocus()
    })

    it('is in the tab order', async () => {
      const { user, box } = renderField([typedChip('a@x.com')])

      await user.click(box)
      await user.keyboard('{Shift>}{Tab}{/Shift}')

      expect(screen.getByRole('button', { name: 'Remove a@x.com' })).toHaveFocus()
    })
  })

  describe('how a chip renders', () => {
    it('renders a typed chip neutral, never in the accent', () => {
      renderField([typedChip('ann@acme.com')])

      const chip = screen.getByText('ann@acme.com').closest('span')!.parentElement!
      expect(chip.className).toContain('bg-muted')
      expect(chip.className).not.toContain('bg-primary')
    })

    it('tints a chip that came from the CRM — a branch nothing can reach yet', () => {
      // `recordId` is null on every chip the field itself can build, so this is
      // the only way to see the branch until the CRM lands.
      renderField([{ address: 'ann@acme.com', displayName: 'Ann Reeve', recordId: 'person-1' }])

      const chip = screen.getByText('Ann Reeve').closest('span')!.parentElement!
      expect(chip.className).toContain('bg-primary/10')
    })

    it('shows the display name when there is one, and the address otherwise', () => {
      renderField([
        { address: 'ann@acme.com', displayName: 'Ann Reeve', recordId: 'person-1' },
        typedChip('bo@acme.com'),
      ])

      expect(screen.getByText('Ann Reeve')).toBeInTheDocument()
      expect(screen.getByText('bo@acme.com')).toBeInTheDocument()
    })

    it('wraps chips onto the next line inside a bounded field', () => {
      // Eight chips must not push the card past its fixed `h-[26rem]`. The
      // browser walk is the real check; this only pins the two classes that
      // make wrapping — rather than sideways scrolling, or growing — possible.
      const { box } = renderField(
        Array.from({ length: 8 }, (_, i) => typedChip(`person-${i}@acme.com`)),
      )

      const wrap = box.parentElement!
      expect(wrap.className).toContain('flex-wrap')
      expect(wrap.className).toContain('max-h-16')
      expect(chipAddresses()).toHaveLength(8)
    })
  })

  describe('the 100-recipient cap', () => {
    const full = Array.from({ length: 100 }, (_, i) => typedChip(`person-${i}@acme.com`))

    it('says how to make room instead of silently dropping the address', async () => {
      const { user, box } = renderField(full)

      expect(screen.getByText('Remove a recipient to add another.')).toBeInTheDocument()

      await user.type(box, 'one-more@acme.com{Enter}')

      expect(chipAddresses()).toHaveLength(100)
    })

    it('stays quiet below the cap', () => {
      renderField(full.slice(0, 99))

      expect(screen.queryByText('Remove a recipient to add another.')).not.toBeInTheDocument()
    })
  })
})
