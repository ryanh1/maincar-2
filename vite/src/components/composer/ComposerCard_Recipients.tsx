import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { RecipientChip } from '@/lib/emailTypes'

/**
 * The most addresses one field will hold.
 *
 * Matches the server's own cap on `toAddrs` / `ccAddrs` / `bccAddrs`
 * (SPEC-composer-recipients.md → "capped at 100 per field"), so the 101st is
 * refused at the keystroke rather than as a 400 a second later.
 */
const MAX_RECIPIENTS = 100

/**
 * The longest address the server will store, so the box stops there too.
 * Shape only — `"ann@"` is a perfectly good value mid-word.
 */
const MAX_ADDRESS_LENGTH = 320

/** Said only at the cap, and it names the way out rather than the rule. */
const AT_CAP_MESSAGE = 'Remove a recipient to add another.'

/**
 * Trim, and drop the separators a paste drags along.
 *
 * `,` never survives a keystroke — `onKeyDown` turns it into a chip — but it
 * does arrive on a paste, and a chip reading `ann@acme.com,` is a chip that
 * will bounce at send.
 */
function cleanAddress(raw: string): string {
  return raw.trim().replace(/^[,;\s]+|[,;\s]+$/g, '')
}

interface RecipientFieldProps {
  /** `To`, `Cc`, or `Bcc`. Shown in the row's label and read by screen readers. */
  label: string
  /** The chips this field holds. The parent owns them; this control never does. */
  chips: RecipientChip[]
  onChange: (chips: RecipientChip[]) => void
  /** `To` autofocuses when a card opens. Cc and Bcc do not. */
  autoFocus?: boolean
}

/**
 * One To/Cc/Bcc row: a label, the chips, and the box you type the next one in.
 *
 * **A recipient is a chip, not text.** That is the whole point of the control
 * (SPEC-composer-recipients.md → Objective): one `Backspace` removes a whole
 * person, so a rep can address five people and drop one without the mouse.
 *
 * There is deliberately **no autocomplete**. It is specified in full under the
 * spec's § Deferred and waits on the CRM schema; a suggestion list with nothing
 * behind it would be a live-looking control that does nothing
 * (CLAUDE.md → Verification).
 *
 * The pending text is local state and the chips are not, because the two have
 * different owners: half a typed address belongs to this box, and a committed
 * recipient belongs to the draft that autosaves it.
 */
export function RecipientField({ label, chips, onChange, autoFocus }: RecipientFieldProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  const atCap = chips.length >= MAX_RECIPIENTS

  /**
   * Commit whatever is in the box. Returns nothing on purpose: every caller
   * wants the box emptied, and none of them care whether a chip appeared.
   *
   * A duplicate is matched case-insensitively and simply does not add a second
   * chip — `Ann@Acme.com` and `ann@acme.com` are one person, and the address
   * already on screen is the one that stays.
   */
  function commitTyped() {
    const address = cleanAddress(query)
    // An empty box adds nothing. No empty chip, ever.
    if (address === '') {
      setQuery('')
      return
    }

    const alreadyThere = chips.some(
      (chip) => chip.address.toLowerCase() === address.toLowerCase(),
    )
    if (alreadyThere || atCap) {
      setQuery('')
      return
    }

    // `recordId` is null for every typed chip, and stays on the type anyway:
    // it is what will make a chip a link to a person once the CRM lands.
    onChange([...chips, { address, displayName: null, recordId: null }])
    setQuery('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Backspace on an empty box deletes the WHOLE last chip, not one character
    // of it. With text in the box it is left alone and edits the text.
    if (event.key === 'Backspace' && query === '' && chips.length > 0) {
      event.preventDefault()
      onChange(chips.slice(0, -1))
      return
    }

    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      // Nothing typed: Enter and comma do nothing, and Tab is left to move
      // focus the way Tab always does.
      if (cleanAddress(query) === '') return
      event.preventDefault()
      commitTyped()
    }
  }

  function removeAt(index: number) {
    onChange(chips.filter((_, i) => i !== index))
    inputRef.current?.focus()
  }

  return (
    <div className="shrink-0">
      <div
        // The row's bottom border is the field's edge, and it turns `primary`
        // on focus. A ring inside a bordered row would draw two lines where the
        // design system asks for one.
        className="flex items-start gap-2 border-b border-border px-3 py-1 focus-within:border-primary"
        // Clicking the empty space beside the chips is clicking the field.
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
      >
        <label
          htmlFor={inputId}
          className="flex h-6 w-8 shrink-0 items-center text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>

        {/*
          Chips wrap onto the next line rather than scrolling sideways. The
          height is capped so a card holding a dozen recipients still fits the
          fixed `h-[26rem]` card instead of pushing the footer off the bottom.
        */}
        <div className="flex max-h-16 min-w-0 flex-1 flex-wrap items-center gap-1 overflow-y-auto">
          {chips.map((chip, index) => (
            <Chip
              key={`${chip.address.toLowerCase()}-${index}`}
              chip={chip}
              onRemove={() => removeAt(index)}
            />
          ))}

          <input
            id={inputId}
            ref={inputRef}
            type="text"
            autoFocus={autoFocus}
            value={query}
            maxLength={MAX_ADDRESS_LENGTH}
            // A half-typed address is not an address yet, so nothing here
            // guesses at deliverability. The one real check is at send.
            autoComplete="off"
            spellCheck={false}
            placeholder={chips.length === 0 ? 'Add a recipient' : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            // Blur commits what was typed rather than throwing it away. A rep
            // who types an address and clicks into the body meant to add it.
            onBlur={commitTyped}
            className="h-6 min-w-32 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {atCap ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">{AT_CAP_MESSAGE}</p>
      ) : null}
    </div>
  )
}

interface ChipProps {
  chip: RecipientChip
  onRemove: () => void
}

/** One recipient, with the `✕` that removes only this one. */
function Chip({ chip, onRemove }: ChipProps) {
  // A chip we matched to a CRM person is tinted; a typed one stays neutral.
  // `recordId` is null on every chip today, so this branch is written and
  // unreachable until the CRM lands — the alternative is rewriting every chip
  // then (SPEC-composer-recipients.md → Deferred, criterion 5).
  const isKnownPerson = chip.recordId !== null

  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-xs',
        isKnownPerson
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted text-foreground',
      )}
    >
      <span className="min-w-0 truncate" title={chip.address}>
        {chip.displayName ?? chip.address}
      </span>
      <button
        type="button"
        // Named, not "Remove", because eight chips in a row all read the same
        // otherwise and a screen reader user cannot tell which one is which.
        aria-label={`Remove ${chip.address}`}
        onClick={onRemove}
        className="shrink-0 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <X size={14} />
      </button>
    </span>
  )
}
