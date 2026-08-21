import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'

import { cn } from '@/lib/utils'
import { buildEditorExtensions } from './editorExtensions'
import { RichTextEditorToolbar } from './RichTextEditor_Toolbar'
import './richTextEditor.css'

/**
 * What the host is handed when the rep asks for a link.
 *
 * `apply` is the whole contract: the editor keeps its own selection and its own
 * command chain, and the host only has to decide on a string. Passing `null`
 * removes the link. Anything the host cannot validate it simply does not apply.
 */
export interface LinkRequest {
  /** The href already on the selection, or `null` when there is no link yet. */
  href: string | null
  /** Set (or with `null`, clear) the link on the selection the rep had. */
  apply: (href: string | null) => void
}

export interface RichTextEditorProps {
  /**
   * The HTML the editor OPENS with. **Read once, on mount, and never again.**
   *
   * Deliberately not called `value`: this is not half of a controlled pair, and
   * there is no matching `value` prop anywhere on this component. See the note
   * on the component below for why that is load-bearing. To show a different
   * document, remount with a different React `key`.
   */
  initialHtml?: string
  /**
   * Called with the full HTML after every change the rep makes. Never called
   * for `initialHtml`, so a host can compare against its own saved copy without
   * a first-render write.
   */
  onChange?: (html: string) => void
  /** Gone on the first keystroke. */
  placeholder?: string
  /** Names the editable region for screen readers. Required — there is no default. */
  label: string
  /**
   * Asks the host for a URL, on the link button and on `Cmd/Ctrl+K`.
   *
   * Omitted, the link button renders visibly disabled instead of pressing into
   * nothing, and `Cmd/Ctrl+K` falls through to the browser.
   */
  onRequestLink?: (request: LinkRequest) => void
  className?: string
}

/**
 * A shared, generic rich-text editor. Bold, italic, two list types, and links.
 *
 * It knows **nothing** about email, records, drafts, or merge fields, and
 * nothing in `components/composer/` is imported here. That line is what makes
 * the deferred merge-field work a wrapper around this component rather than a
 * rewrite of it (SPEC-composer-body.md → Project structure).
 *
 * ## The caret rule, and how this API enforces it
 *
 * **The editor is created once and never re-seeded.** A rep types; 1200 ms
 * later the host saves; the response comes back carrying the same body; if that
 * response reaches the editor, ProseMirror replaces the document and the caret
 * lands at the end — mid-sentence, while they are still typing. No unit test
 * catches a moving caret, so the API is shaped so a host cannot cause one even
 * by accident:
 *
 * 1. **There is no `value` prop.** The seed is `initialHtml`, which reads as
 *    what it is. `value`/`onChange` would invite a host to wire up a controlled
 *    input, and a controlled rich-text editor is the bug.
 * 2. **`initialHtml` is captured on the first render** — into a `useState`
 *    initializer, whose setter is thrown away — and that captured copy is what
 *    seeds ProseMirror. A later prop value is not ignored by convention; it is
 *    never read.
 * 3. **`useEditor` is given an empty dependency list**, so no prop, no state,
 *    and no re-render can rebuild the editor. The extension list is built once
 *    inside a `useState` initializer for the same reason: a fresh extensions
 *    array tears the editor down.
 * 4. **Everything live is read through a ref** — `onChange` and `onRequestLink`
 *    are re-pointed on every render and called through `live.current`, so a host
 *    may pass fresh closures without any of them reaching the editor's options.
 * 5. **A host that changes `initialHtml` anyway is told so**, once, in dev. The
 *    warning names the prop and the fix, because the symptom — a caret that
 *    jumps every second or so — does not look like a props problem from the
 *    outside.
 *
 * A rep who genuinely needs a different document is opening a different thing,
 * so the host remounts with a new `key`. That is a deliberate, visible act.
 */
export function RichTextEditor({
  initialHtml,
  onChange,
  placeholder = 'Write a message',
  label,
  onRequestLink,
  className,
}: RichTextEditorProps) {
  // Rule 2. A `useState` initializer runs on the first render and never again,
  // so this holds the value the component MOUNTED with for as long as it lives.
  // The setter is deliberately thrown away: there is no way to re-seed.
  const [seed] = useState(() => initialHtml ?? '')

  // Rule 4. Re-pointed after every render, read at call time. This is the
  // pattern the spec prescribes (SPEC-composer-body.md → Code style); the
  // alternative, listing the callbacks as dependencies of the editor, is exactly
  // the teardown being avoided. Updating in an effect rather than during render
  // is safe here because nothing calls through this ref until the rep does
  // something, which is always after the commit that repointed it.
  const live = useRef({ onChange, onRequestLink })
  useEffect(() => {
    live.current = { onChange, onRequestLink }
  })

  // Rule 5. Once per mount, in dev only. The symptom of getting this wrong is a
  // caret that jumps every second or so, which does not look like a props
  // problem from the outside — so the warning names the prop and the fix.
  const warnedRef = useRef(false)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (warnedRef.current) return
    if (initialHtml === undefined || initialHtml === seed) return
    warnedRef.current = true
    console.warn(
      '[RichTextEditor] `initialHtml` changed after mount and was ignored. ' +
        'The editor owns its text while it is open — re-seeding it would move the ' +
        "rep's caret. Pass the value once, or remount with a different `key`.",
    )
  }, [initialHtml, seed])

  // Rule 3. Built once. A new array here is a new editor, and a new editor is a
  // lost caret.
  const [extensions] = useState(() => buildEditorExtensions({ placeholder }))

  const editor = useEditor(
    {
      extensions,
      content: seed,
      immediatelyRender: true,
      // The toolbar follows the caret through `useEditorState` instead. Marking
      // this true re-renders the whole editor on every transaction.
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': label,
          // `min-h-0` and `flex-1` on the wrapper make the editor give up height
          // to the rows above it; the overflow is what keeps a long email
          // scrolling INSIDE the card instead of pushing the footer off the
          // bottom (SPEC-composer-body.md → Acceptance criteria, 5).
          class: 'tiptap min-h-full px-3 py-2 text-sm outline-none',
        },
      },
      onUpdate: ({ editor: current }) => live.current.onChange?.(current.getHTML()),
    },
    // Rule 3, written out. Do not add to this array.
    [],
  )

  /**
   * Raise a link request for whatever is selected right now.
   *
   * The href and the `apply` closure are both built at call time, so the host
   * can hold the request open for as long as a dialog takes and still act on
   * the selection the rep actually had.
   */
  const requestLink = useCallback((): boolean => {
    const handler = live.current.onRequestLink
    if (!handler || !editor) return false

    const href: string | null = editor.getAttributes('link').href ?? null
    handler({
      href,
      apply: (next) => {
        if (next === null) {
          editor.chain().focus().unsetLink().run()
          return
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: next }).run()
      },
    })
    return true
  }, [editor])

  /**
   * `Cmd/Ctrl+K`, handled on the wrapper rather than as a TipTap keymap.
   *
   * A keymap extension would have to be built with the handler inside it, and
   * the extension list is built once — so it could only ever call a stale
   * handler, or force the rebuild that costs the caret. A bubbled keydown reads
   * the current props with no indirection at all. Nothing in the extension list
   * binds `Mod-K`, so the key reaches here untouched.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key.toLowerCase() !== 'k') return
    if (!event.metaKey && !event.ctrlKey) return
    // No handler wired: leave the key to the browser rather than swallowing it
    // to do nothing.
    if (!onRequestLink) return
    event.preventDefault()
    requestLink()
  }

  return (
    <div onKeyDown={onKeyDown} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {/*
        The editable region scrolls; the toolbar below it does not. The toolbar
        is last in the DOM so the tab order runs body → formatting → whatever the
        host puts after it, which is the order a rep works in.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
      <RichTextEditorToolbar editor={editor} onRequestLink={onRequestLink ? requestLink : null} />
    </div>
  )
}
