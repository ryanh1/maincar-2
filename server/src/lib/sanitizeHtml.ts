/**
 * The server-side HTML allow-list (docs/specs/SPEC-composer-body.md → Code style).
 *
 * This is a SECURITY BOUNDARY, not a formatter. Every write path that accepts
 * HTML from a caller — draft bodies today, templates and signatures later —
 * passes through here before the string reaches the database, because anything
 * stored is eventually rendered: in the composer, in a preview, in a sent email.
 * Stored XSS is the failure this file exists to prevent.
 *
 * Three rules it is built on:
 *
 * 1. **An allow-list, never a blocklist.** The list below says what is
 *    PERMITTED. Everything else — `<script>`, `<iframe>`, `<object>`, `<svg>`,
 *    `<style>`, `on*` handlers, `style`, `class`, `srcdoc`, and every tag and
 *    attribute that has not shipped yet — is dropped because it is not named.
 *    A blocklist is wrong the day a new tag ships.
 *
 * 2. **Never hand-roll HTML parsing.** Regex sanitisers are the classic source
 *    of bypasses: `<img/src=x onerror=1>`, `<scr<script>ipt>`, mixed case,
 *    entity-encoded `&#106;avascript:`, an unterminated attribute that swallows
 *    the next tag. `sanitize-html` runs a real tokenizer (htmlparser2) which
 *    lower-cases tags and attributes and decodes entities before the allow-list
 *    is applied, so all of the above arrive as the thing they actually are.
 *
 * 3. **The client's sanitising is never trusted on its own.** DOMPurify in the
 *    editor is a UX nicety. The request that reaches this server did not have to
 *    come from the editor.
 *
 * The output is **idempotent**: sanitising a sanitised string returns it
 * unchanged. That matters because a draft is written on every autosave, so a
 * body round-trips through here dozens of times per email.
 */
import sanitizeHtmlLib from 'sanitize-html'

/**
 * The only tags that survive. Exactly the marks the composer toolbar can
 * produce (SPEC-composer-body.md → 2): bold, italic, underline, a link, and the
 * two list types, in paragraphs.
 */
export const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li']

/**
 * The only attributes that survive, per tag. Nothing carries `style`, `class`,
 * `id`, `data-*`, or any `on*` handler — and `a` is the only tag with
 * attributes at all.
 */
export const ALLOWED_ATTR: Record<string, string[]> = { a: ['href', 'target', 'rel'] }

/**
 * The only URL schemes an `href` may use.
 *
 * `javascript:` and `vbscript:` execute. `data:` is just as bad in a link —
 * `data:text/html,<script>…</script>` runs in the origin of whatever renders it.
 * A scheme that is not on this list means the whole `href` is dropped, leaving
 * an inert `<a>` around the text rather than a live link somewhere unexpected.
 */
export const ALLOWED_SCHEMES = ['http', 'https', 'mailto']

/**
 * Tags whose TEXT is thrown away along with the tag itself.
 *
 * For every other disallowed tag the text is kept and the tag unwrapped, so
 * `<div>Hello</div>` becomes `Hello` rather than nothing — losing a rep's
 * sentence because it was wrapped in a `<span>` would be its own bug. But the
 * contents of these tags are never prose: unwrapping `<script>alert(1)</script>`
 * would leave the literal text `alert(1)` in the email, and `<noscript>` and
 * `<template>` hold markup the parser treats differently from their surroundings
 * — a well-known mutation-XSS lever.
 */
const NON_TEXT_TAGS = [
  'script',
  'style',
  'textarea',
  'option',
  'noscript',
  'iframe',
  'object',
  'embed',
  'template',
  'title',
]

const OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTR,
  allowedSchemes: ALLOWED_SCHEMES,
  // Applies the scheme check to `href` specifically. Without naming the
  // attribute, a scheme check is not guaranteed to reach it.
  allowedSchemesByTag: { a: ALLOWED_SCHEMES },
  allowedSchemesAppliedToAttributes: ['href'],
  // `//evil.example/x` inherits the page's scheme. It is never something a rep
  // typed, and it is a cheap way to smuggle a link past a scheme check.
  allowProtocolRelative: false,
  // Unwrap the tag, keep the text — except for NON_TEXT_TAGS above.
  disallowedTagsMode: 'discard',
  nonTextTags: NON_TEXT_TAGS,
  // Comments need no option: `sanitize-html` registers no `oncomment` handler on
  // the parser at all, so a comment is never written to the output. That matters
  // here because `<!--[if IE]><script>…<![endif]-->` is markup to a parser and a
  // comment to everyone reading the diff — a test below pins the behaviour down
  // so a future upgrade that adds a `keep comments` default cannot go unnoticed.
  //
  // `class` is likewise not on `ALLOWED_ATTR` for any tag, so no class survives.
  // A link that opens a new tab must not hand the opener a live `window`
  // reference. Deterministic, so it does not break idempotency: the second pass
  // sees the rel it wrote on the first and rewrites the same value.
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target) {
        return { tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } }
      }
      return { tagName, attribs }
    },
  },
}

/**
 * Sanitise one HTML fragment against the allow-list above.
 *
 * Returns HTML, never `null` — an input that was entirely disallowed comes back
 * as an empty string.
 */
export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtmlLib(html, OPTIONS)
}

/**
 * The nullable form, for the columns that hold `bodyHtml`.
 *
 * `null` means "the rep has not written a body", and that is a different fact
 * from "the rep wrote a body of nothing", so it is passed through rather than
 * turned into `''`.
 */
export function sanitizeOptionalRichTextHtml(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null
  return sanitizeRichTextHtml(html)
}
