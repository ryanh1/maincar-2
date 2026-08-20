/**
 * The ONLY way to mark a required field. Never write an inline `<span>*</span>`
 * (CLAUDE.md → UI Components → Required Field Asterisks).
 *
 *   <Label>Company name <RequiredAsterisk /></Label>
 *
 * `aria-hidden` because the asterisk is decorative — the input itself carries
 * `required`, which is what a screen reader announces.
 */
export function RequiredAsterisk() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  )
}
