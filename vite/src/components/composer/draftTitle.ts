import type { EmailDraft } from '@/lib/emailTypes'

/**
 * The one line that names a draft, used by the card header and by the minimized
 * chip so a rep reads the same words whichever shape the draft is in.
 *
 * Kept out of `ComposerDock.tsx` because a module that exports both a component
 * and a non-component breaks fast refresh and trips `eslint-plugin-react-refresh`
 * — the same reason `buttonVariants.ts` sits beside `button.tsx`.
 *
 * Order of preference is the spec's (SPEC-composer-dock.md → Visual spec):
 * subject and recipient, then the subject alone, then the recipient alone, then
 * "New message". A draft is created empty, so the last case is the common one.
 */
export function draftTitle(draft: Pick<EmailDraft, 'subject' | 'toAddrs'>): string {
  const subject = draft.subject?.trim() ?? ''
  // The first address the rep actually typed. A recipient field can hold a blank
  // chip while it is being edited, and a title reading " — " would be noise.
  const recipient = draft.toAddrs.map((a) => a.trim()).find((a) => a.length > 0) ?? ''

  if (subject && recipient) return `${subject} — ${recipient}`
  if (subject) return subject
  if (recipient) return recipient
  return 'New message'
}
