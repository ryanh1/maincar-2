/**
 * The extension list, in one place (SPEC-composer-body.md → Project structure).
 *
 * **What this list produces is a contract, not a preference.** Every string the
 * editor emits is run through the server's allow-list before it is stored
 * (`server/src/lib/sanitizeHtml.ts`), and that list is exactly:
 *
 *     p · br · strong · em · u · a[href,target,rel] · ul · ol · li
 *
 * with `href` limited to `http`, `https`, and `mailto`. Anything the editor can
 * produce beyond that is silently deleted on save, which is the worst kind of
 * bug: a rep formats a heading, the card looks right, and the email that goes
 * out has lost it. So every StarterKit extension whose output is not on that
 * list is turned OFF here rather than left on and stripped later.
 *
 * The list is deliberately free of anything about email, records, or merge
 * fields — `RichTextEditor` is a shared, generic component, and keeping that
 * line clean is what makes the deferred merge-field work a wrapper rather than
 * a rewrite.
 */
import type { Extensions } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'

/**
 * The tags the editor is allowed to emit. The same list the server enforces.
 *
 * Duplicated rather than imported because the client cannot import from
 * `server/`, and a shared package for nine strings would be the bigger mistake.
 * `RichTextEditor.test.tsx` asserts the editor's real output against this array,
 * so the copy cannot drift without a red test.
 */
export const EDITOR_ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li'] as const

/** The only schemes an `href` may carry. Matches `ALLOWED_SCHEMES` on the server. */
export const EDITOR_ALLOWED_SCHEMES = ['http', 'https', 'mailto'] as const

/**
 * What a link gets when there is no scheme at all — `acme.com` becomes
 * `https://acme.com`. Never `http`, which is TipTap's own default.
 */
export const EDITOR_DEFAULT_PROTOCOL = 'https'

/**
 * Every link opens in a new tab, and a new tab never gets a live `window`
 * reference back to the opener. The server rewrites `rel` to the same value, so
 * a stored link and a freshly typed one are the same string.
 */
export const EDITOR_LINK_ATTRIBUTES = { target: '_blank', rel: 'noopener noreferrer' }

/**
 * Is this URL's scheme one we allow?
 *
 * A URL with no scheme passes: `defaultProtocol` above supplies `https` before
 * it is stored. A URL WITH a scheme must name one of the three. That is what
 * refuses `javascript:alert(1)` and `data:text/html,…` at the point a rep types
 * or pastes them, rather than leaving it to the server to quietly drop the
 * `href` and leave an inert `<a>` behind.
 *
 * Exported for the URL dialog, which has to say no with a message.
 */
export function hasAllowedScheme(url: string): boolean {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim())
  if (!match) return true
  return (EDITOR_ALLOWED_SCHEMES as readonly string[]).includes(match[1].toLowerCase())
}

interface EditorExtensionsOptions {
  /** Shown while the document is empty. Rendered by `richTextEditor.css`. */
  placeholder: string
}

/**
 * Build the extension list. Call it **once** per editor.
 *
 * Nothing live may be passed in here. Rebuilding this array tears the editor
 * down and drops the rep's caret (SPEC-composer-body.md → Code style), so
 * anything that changes — the callbacks, the link handler — is handled outside
 * the editor rather than configured into it.
 *
 * `Cmd/Ctrl+K` is deliberately NOT a keyboard shortcut extension for that same
 * reason: a link needs a URL from outside the editor, so the host listens for
 * the key on the wrapper instead and keeps this list free of anything live.
 */
export function buildEditorExtensions({ placeholder }: EditorExtensionsOptions): Extensions {
  return [
    StarterKit.configure({
      // OFF, because the server's allow-list has no tag for any of them.
      // Leaving one on means a mark that looks applied and is gone on save.
      blockquote: false, // <blockquote>
      code: false, // <code>
      codeBlock: false, // <pre><code>
      heading: false, // <h1>…<h6>
      horizontalRule: false, // <hr>
      strike: false, // <s>
      // Configured below instead, so the link rules live in one place.
      link: false,
      // An auto-appended empty paragraph at the end of the document. Harmless on
      // screen, but it means every saved body ends in a stray `<p></p>` that
      // round-trips forever. Enter twice already leaves a list.
      trailingNode: false,
      // Everything else stays: paragraph, text, bold (<strong>), italic (<em>),
      // underline (<u>), hardBreak (<br>), bulletList/orderedList/listItem, plus
      // the behaviour-only ones — undoRedo, dropcursor, gapcursor, listKeymap —
      // which emit no HTML at all.
    }),
    Link.configure({
      protocols: ['mailto'],
      defaultProtocol: EDITOR_DEFAULT_PROTOCOL,
      HTMLAttributes: EDITOR_LINK_ATTRIBUTES,
      // Clicking inside the editor puts the caret down. It does not navigate
      // away from a half-written email.
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      isAllowedUri: (url, { defaultValidate }) => defaultValidate(url) && hasAllowedScheme(url),
    }),
    Placeholder.configure({ placeholder }),
  ]
}
