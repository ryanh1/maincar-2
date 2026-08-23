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
import { mergeAttributes, type Extensions } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import Placeholder from '@tiptap/extension-placeholder'
import { ReactRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { SuggestionProps } from '@tiptap/suggestion'

import { MentionSuggestionMenu, type MentionSuggestionMenuHandle } from './MentionSuggestionMenu'
import { filterMentionSuggestions, type MentionSuggestion } from './mentionResolver'

/**
 * The tags the editor is allowed to emit. The same list the server enforces.
 *
 * Duplicated rather than imported because the client cannot import from
 * `server/`, and a shared package for nine strings would be the bigger mistake.
 * `RichTextEditor.test.tsx` asserts the editor's real output against this array,
 * so the copy cannot drift without a red test.
 */
export const EDITOR_ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'a', 'span', 'ul', 'ol', 'li'] as const

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

/** The scheme at the front of a URL, lower-cased, or `null` if it carries none. */
function schemeOf(url: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim())
  return match ? match[1].toLowerCase() : null
}

/**
 * Is this URL's scheme one we allow?
 *
 * A URL with no scheme passes, because the **caller** is going to supply one:
 * `normalizeLinkUrl` puts `https://` on a typed `acme.com` before it is stored,
 * and linkify puts `defaultProtocol` on an autolinked one. A URL WITH a scheme
 * must name one of the three. That is what refuses `javascript:alert(1)` and
 * `data:text/html,…` at the point a rep types them, rather than leaving it to
 * the server to quietly drop the `href` and leave an inert `<a>` behind.
 *
 * This is the right question wherever something downstream completes the URL:
 * the dialog, and TipTap's autolinking. It is the WRONG question for an `href`
 * read straight out of pasted HTML, where nothing completes it — that one is
 * `isStorableHref` below.
 */
export function hasAllowedScheme(url: string): boolean {
  const scheme = schemeOf(url)
  if (scheme === null) return true
  return (EDITOR_ALLOWED_SCHEMES as readonly string[]).includes(scheme)
}

/**
 * Can this string be stored as an `href` exactly as written?
 *
 * The stricter half of the pair: a scheme is **required**, and it must be one of
 * the three. `hasAllowedScheme` above lets a scheme-less string through on the
 * promise that its caller will complete it. This one is for the path where
 * nobody does, and it is the same statement as `ALLOWED_URI` in
 * `sanitizeStoredHtml.ts` — `^(?:https?|mailto):` — said in terms of the scheme
 * list rather than as a second regex.
 *
 * That gap is the whole of MAI-90. A paragraph pasted out of a real web page
 * arrives full of relative hrefs — `./Cargo`, `/wiki/Ship`, `#cite_note-1` — and
 * **nothing adds a scheme to an href read out of pasted HTML**: `defaultProtocol`
 * only ever reaches a URL that linkify or the dialog built. So the editor kept
 * the relative href and the link looked right, `sanitizeStoredHtml` then dropped
 * the href on the way to the server, and the anchor was stored as `<a target
 * rel>` with no `href` at all. TipTap will not parse an href-less anchor as a
 * link, so on the next reload the rep's link had silently become plain text. A
 * real Wikipedia paste lost 18 of 19 links that way.
 *
 * Refusing it at the parse seam instead means the paste is honest: a relative
 * link arrives as plain text, visibly, while the rep can still do something
 * about it.
 */
export function isStorableHref(url: string): boolean {
  return schemeOf(url) !== null && hasAllowedScheme(url)
}

/**
 * The Link mark, with one rule replaced: an `<a>` is only read back as a link if
 * its `href` is one we can store.
 *
 * This is a narrower seam than `isAllowedUri` on purpose, and the reason is
 * worth writing down. TipTap hands `isAllowedUri` two different questions
 * through one hook. `parseHTML` asks it about an `href` used **verbatim**, which
 * is where MAI-90 lives. Autolinking asks it about the **text** a rep typed —
 * `acme.com`, `ann@acme.com` — and then builds the href itself with
 * `defaultProtocol`. Tightening the shared hook fixes the paste and breaks the
 * typing: measured, a strict `isAllowedUri` stopped both `acme.com` and
 * `ann@acme.com` from ever autolinking, which is not a trade an email composer
 * should make. So the strict rule goes on the parse rule, which is the only
 * place the two questions can be told apart.
 *
 * The rule mirrors TipTap's own (`a[href]`, `getAttrs` returning `false` to
 * refuse and `null` to accept and let each attribute parse itself) with a
 * stricter test. Ours rejects a strict superset of what TipTap's rejects, so
 * replacing it can only ever refuse more, never allow more.
 *
 * Known limit: a link pasted as markdown *text*, `[Cargo](./Cargo)`, does not go
 * through this rule, so a relative target there still reaches the sanitiser and
 * is still dropped. Closing that would mean tightening the shared hook and
 * losing autolinking, so it stays open deliberately.
 */
const StorableLink = Link.extend({
  parseHTML() {
    return [
      {
        tag: 'a[href]',
        getAttrs: (element) =>
          isStorableHref((element as HTMLElement).getAttribute('href') ?? '') ? null : false,
      },
    ]
  },
})

interface EditorExtensionsOptions {
  /** Shown while the document is empty. Rendered by `richTextEditor.css`. */
  placeholder: string
  /** Reads the live catalog without rebuilding an editor just to refresh a picker. */
  getMentionItems: () => MentionSuggestion[]
}

/** Stable target kind carried with the node, not inferred from a renameable label. */
const MaincarMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mention-kind'),
        renderHTML: (attributes) =>
          typeof attributes.kind === 'string' ? { 'data-mention-kind': attributes.kind } : {},
      },
    }
  },
})

function buildMentionExtension(getMentionItems: () => MentionSuggestion[]) {
  return MaincarMention.configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ node, options }) => [
      'span',
      mergeAttributes(options.HTMLAttributes, { 'data-mention-kind': (node.attrs as { kind?: string }).kind ?? '' }),
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
    suggestion: {
      items: ({ query }) => filterMentionSuggestions(getMentionItems(), query).slice(0, 24),
      command: ({ editor, range, props }) => {
        const selected = props as unknown as MentionSuggestion
        editor
          .chain()
          .focus()
          .insertContentAt(range, { type: 'mention', attrs: { id: selected.id, label: selected.label, kind: selected.kind } })
          .insertContent(' ')
          .run()
      },
      render: () => {
        let component: ReactRenderer<MentionSuggestionMenuHandle, SuggestionProps<MentionSuggestion, MentionSuggestion>> | null = null
        let unmount: (() => void) | undefined
        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionSuggestionMenu, { editor: props.editor, props })
            unmount = props.mount(component.element)
          },
          onUpdate: (props) => component?.updateProps(props),
          onKeyDown: (props) => component?.ref?.onKeyDown(props.event) ?? false,
          onExit: () => {
            unmount?.()
            component?.destroy()
            component = null
          },
        }
      },
    },
  })
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
export function buildEditorExtensions({ placeholder, getMentionItems }: EditorExtensionsOptions): Extensions {
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
    StorableLink.configure({
      // Linkify already has native support for `mailto`. Registering it as a
      // custom scheme for every editor mount is both redundant and unsafe once
      // Linkify has tokenized text: it warns that custom schemes must be
      // registered before initialization.
      defaultProtocol: EDITOR_DEFAULT_PROTOCOL,
      HTMLAttributes: EDITOR_LINK_ATTRIBUTES,
      // Clicking inside the editor puts the caret down. It does not navigate
      // away from a half-written email.
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      // Deliberately the LOOSER of the two checks. This hook also validates
      // autolinking, which asks about the text a rep typed rather than about a
      // finished href, so a scheme-less string has to pass here — see
      // `StorableLink` above, which carries the strict rule where it belongs.
      // What this refuses is a scheme we do not allow: `javascript:alert(1)`.
      isAllowedUri: (url, { defaultValidate }) => defaultValidate(url) && hasAllowedScheme(url),
    }),
    buildMentionExtension(getMentionItems),
    Placeholder.configure({ placeholder }),
  ]
}
