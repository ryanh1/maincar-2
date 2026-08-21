/**
 * The allow-list behind `SanitizedHtml.tsx`, the one place stored HTML is ever
 * rendered into the DOM.
 *
 * This is a **security boundary**, not a formatter, and it is the second of two
 * — `server/src/lib/sanitizeHtml.ts` is the first. Two are needed because they
 * fail in different directions:
 *
 * - The server's copy protects the database. It cannot protect a row that was
 *   already written: by an older build whose allow-list was looser, by a fixture,
 *   by a seed script, by a direct `psql` write, or through a write path someone
 *   adds next year and forgets to run through the sanitiser.
 * - This copy protects the browser. Stored XSS does not fire when a string is
 *   saved; it fires the moment `innerHTML` parses it, which is here. So the
 *   string is sanitised again on the way out, against the same allow-list, no
 *   matter where it came from or how long it has been sitting there.
 *
 * Neither is allowed to be the looser one. A client list that permits something
 * the server strips is a hole, so the two are pinned to each other by name below
 * and by test.
 *
 * **`SanitizedHtml` is the only component in the app that may use React's raw
 * HTML prop.** Grep `vite/src` for that prop and there is exactly one hit, and
 * that is the point of the pair: one boundary, auditable in one grep, rather
 * than a rule everyone is asked to remember. Anything else that needs to show
 * stored HTML renders it through that component.
 *
 * This module is also the only place `dompurify` is imported
 * (.claude/rules/dependencies-and-config.md → third-party SDKs): swapping the
 * sanitiser touches this file and nothing else.
 */
import createDOMPurify, { type Config, type DOMPurify } from 'dompurify'

/**
 * The only tags that survive. **Character for character, the server's
 * `ALLOWED_TAGS`.**
 *
 * Duplicated rather than imported because the client cannot import from
 * `server/`, and a shared package for nine strings would be the bigger mistake —
 * the same call `editorExtensions.ts` makes for the same reason. `SanitizedHtml.test.tsx` pins
 * the array, so the copy cannot drift without a red test.
 */
export const SANITIZED_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  'a',
  'ul',
  'ol',
  'li',
] as const

/**
 * The only attributes that survive, and only on `<a>`.
 *
 * DOMPurify's `ALLOWED_ATTR` is a flat list with no notion of which tag an
 * attribute belongs to, so on its own it would also permit `<p href="…">` —
 * inert, but looser than the server's per-tag `ALLOWED_ATTR`, and "looser than
 * the server" is the one thing this file may not be. The hook below closes that
 * gap by stripping all three from anything that is not an anchor.
 */
export const SANITIZED_ANCHOR_ATTR = ['href', 'target', 'rel'] as const

/** The only schemes an `href` may use. The server's `ALLOWED_SCHEMES`. */
export const SANITIZED_ALLOWED_SCHEMES = ['http', 'https', 'mailto'] as const

/**
 * What an `href` must match.
 *
 * Anchored, so `data:text/html;x=https://` cannot pass by containing an allowed
 * scheme somewhere inside it. Scheme-relative (`//evil.example`) and relative
 * (`/pricing`) hrefs both fail it, which is *stricter* than the server — it
 * permits a relative href — and stricter is the safe direction. Nothing the
 * composer produces is relative: the editor's `defaultProtocol` and the URL
 * dialog both put a scheme on before a link is ever stored.
 */
const ALLOWED_URI = /^(?:https?|mailto):/i

/**
 * Tags whose TEXT is discarded along with the tag.
 *
 * Every other disallowed tag is unwrapped and its text kept, so `<div>Hi</div>`
 * becomes `Hi` rather than nothing — losing a rep's sentence because it was
 * wrapped in a `<span>` would be its own bug. But the contents of these are
 * never prose. DOMPurify already defaults this list to `script`, `style`, `svg`,
 * `noscript`, `template`, `title`, `iframe`, and friends; these four are the
 * ones the server names that DOMPurify does not, added so the two agree on what
 * a rep sees as well as on what is safe.
 */
const EXTRA_FORBID_CONTENTS = ['textarea', 'option', 'object', 'embed'] as const

const OPTIONS: Config = {
  ALLOWED_TAGS: [...SANITIZED_ALLOWED_TAGS],
  ALLOWED_ATTR: [...SANITIZED_ANCHOR_ATTR],
  ALLOWED_URI_REGEXP: ALLOWED_URI,
  // DOMPurify runs `ALLOWED_URI_REGEXP` against EVERY attribute value, not just
  // the ones that hold a URL, so without this `target="_blank"` and
  // `rel="noopener noreferrer"` both fail the scheme test and are thrown away.
  // Naming them URI-safe scopes the scheme check to `href`, which is the
  // server's `allowedSchemesAppliedToAttributes: ['href']` said in DOMPurify's
  // words. Neither attribute ever holds a URL, so nothing is loosened.
  ADD_URI_SAFE_ATTR: ['target', 'rel'],
  ADD_FORBID_CONTENTS: [...EXTRA_FORBID_CONTENTS],
  // `aria-*` and `data-*` are allowed by default and are not on the server's
  // list, so they are turned off rather than left to be stripped by a later
  // reader who wonders why they are there.
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // Unwrap a disallowed tag and keep its text, except for the forbidden-contents
  // list above. This is the server's `disallowedTagsMode: 'discard'`.
  KEEP_CONTENT: true,
  // A fragment, not a document: no `<html>`, `<head>`, or `<body>` is invented
  // around a paragraph.
  WHOLE_DOCUMENT: false,
  // A string back, so the caller cannot accidentally hold a live node.
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  RETURN_TRUSTED_TYPE: false,
}

/**
 * Our own DOMPurify instance, built once, lazily.
 *
 * Its own instance because hooks are registered per instance and the default
 * export is shared with anything else that might import the library — a hook on
 * that would be a global side effect. Lazily because the factory needs a real
 * `window`, and a module-scope call would throw the moment this file is imported
 * anywhere without a DOM.
 */
let purifier: DOMPurify | null = null

function getPurifier(): DOMPurify {
  if (purifier) return purifier

  const instance = createDOMPurify(window)

  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName.toLowerCase() !== 'a') {
      // The per-tag half of the allow-list DOMPurify has no setting for.
      for (const name of SANITIZED_ANCHOR_ATTR) node.removeAttribute(name)
      return
    }
    // A link that opens a new tab must never hand the opener a live `window`
    // reference. The server writes exactly this string, so a stored link and a
    // re-sanitised one are the same bytes, which is what keeps the output
    // idempotent.
    if (node.hasAttribute('target')) node.setAttribute('rel', 'noopener noreferrer')
  })

  purifier = instance
  return instance
}

/**
 * Sanitise one stored HTML fragment for rendering.
 *
 * Returns HTML, never `null` — an input that was entirely disallowed comes back
 * as an empty string. Idempotent: sanitising a sanitised string returns it
 * unchanged.
 *
 * Exported so the rules can be tested directly. Rendering still goes through
 * `SanitizedHtml`; there is no supported path that sanitises here and injects
 * somewhere else.
 */
export function sanitizeStoredHtml(html: string): string {
  return getPurifier().sanitize(html, OPTIONS)
}
