/**
 * The link URL rules, kept out of the dialog that shows them.
 *
 * Pure and free of React so the rules can be read and tested on their own — and
 * because a `.tsx` that exports anything but a component breaks fast refresh,
 * which is the same reason `editorExtensions.ts` beside it is a `.ts`.
 */
import {
  EDITOR_ALLOWED_SCHEMES,
  EDITOR_DEFAULT_PROTOCOL,
  hasAllowedScheme,
} from './editorExtensions'

/** What `normalizeLinkUrl` decided about a string a rep typed. */
export type LinkUrlResult = { ok: true; href: string } | { ok: false; message: string }

/**
 * The three things the dialog can say. Constants so the tests assert the message
 * a rep actually reads rather than a paraphrase of it.
 */
export const LINK_URL_MESSAGES = {
  empty: 'Enter a web address.',
  scheme: 'Use an http, https, or mailto address.',
  invalid: 'Enter a valid web address, like https://acme.com.',
} as const

/**
 * Drop every character a URL cannot really contain.
 *
 * A URL holds no raw space and no control character, but a browser will happily
 * *ignore* tabs and newlines inside an `href` rather than reject it — which is
 * how `java&#9;script:alert(1)` gets past a scheme check that reads the string
 * literally. Removing them first means the scheme test below sees the scheme the
 * browser would see.
 *
 * Written as a loop over code points rather than as a character class, because a
 * regex holding real control characters is unreadable in a diff and `eslint`
 * refuses it outright (`no-control-regex`). The range is every C0 control plus
 * the space, then DEL and the C1 controls.
 */
function stripIgnoredCharacters(url: string): string {
  let kept = ''
  for (const character of url) {
    const code = character.codePointAt(0)!
    if (code <= 0x20) continue
    if (code >= 0x7f && code <= 0x9f) continue
    kept += character
  }
  return kept
}

/** Does the string start with `scheme:`? Returns the scheme, lower-cased. */
function schemeOf(url: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)
  return match ? match[1].toLowerCase() : null
}

/**
 * Turn what a rep typed into an href we are willing to store, or into the
 * reason we are not.
 *
 * **This mirrors `server/src/lib/sanitizeHtml.ts`, and it must never be the
 * looser of the two.** Everything it accepts survives the server's allow-list;
 * everything the server would strip is refused here *with a message*, because a
 * URL that is silently dropped leaves a rep looking at text that reads like a
 * link, is not one, and never said so (SPEC-composer-body.md → 3).
 *
 * Pure, exported, and tested on its own: the rules are the valuable part, and a
 * rule that can only be exercised by opening a dialog does not get exercised.
 */
export function normalizeLinkUrl(raw: string): LinkUrlResult {
  const cleaned = stripIgnoredCharacters(raw)
  if (cleaned === '') return { ok: false, message: LINK_URL_MESSAGES.empty }

  // `//evil.example/x` inherits whatever scheme the page is on. The server sets
  // `allowProtocolRelative: false` and drops it; prefixing `https:` here would
  // accept a form no rep means to type, so it is refused instead.
  if (cleaned.startsWith('//')) return { ok: false, message: LINK_URL_MESSAGES.invalid }

  // The shared check, so the dialog and the editor's own paste handling cannot
  // disagree about what a scheme may be.
  if (!hasAllowedScheme(cleaned)) return { ok: false, message: LINK_URL_MESSAGES.scheme }

  // No scheme at all: `acme.com` becomes `https://acme.com`. Never `http`
  // (SPEC-composer-body.md → 3).
  const href = schemeOf(cleaned) ? cleaned : `${EDITOR_DEFAULT_PROTOCOL}://${cleaned}`

  // Parse it once to catch what a regex cannot — `https://` on its own, a host
  // of nothing, a port that is not a number.
  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return { ok: false, message: LINK_URL_MESSAGES.invalid }
  }

  // Belt and braces: the parser's idea of the scheme, not ours.
  const protocol = parsed.protocol.replace(/:$/, '').toLowerCase()
  if (!(EDITOR_ALLOWED_SCHEMES as readonly string[]).includes(protocol)) {
    return { ok: false, message: LINK_URL_MESSAGES.scheme }
  }
  // `mailto:` with no address is a valid URL and a useless link.
  if (protocol === 'mailto' && parsed.pathname.trim() === '') {
    return { ok: false, message: LINK_URL_MESSAGES.invalid }
  }

  // The string we built, not `parsed.toString()`, which would rewrite
  // `https://acme.com` as `https://acme.com/` and quietly edit what the rep
  // typed. Only the scheme is ever added.
  return { ok: true, href }
}
