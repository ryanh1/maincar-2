import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Bold, Italic, Link2, List, ListOrdered, Underline } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

import { Button } from '@/components/ui/button'

/**
 * The state of the formatting controls at the caret.
 *
 * Read through `useEditorState` rather than by re-rendering the editor on every
 * transaction: the toolbar has to follow the caret, and the editor must not be
 * torn down to make that happen.
 */
interface ToolbarState {
  bold: boolean
  italic: boolean
  underline: boolean
  bulletList: boolean
  orderedList: boolean
  link: boolean
}

interface RichTextEditorToolbarProps {
  editor: Editor
  /**
   * Ask the host for a URL. `null` means no host supplied one, and the link
   * button renders visibly disabled rather than doing nothing when pressed
   * (CLAUDE.md → Verification). The URL dialog arrives with `composer-body`'s
   * next issue and fills this in.
   */
  onRequestLink: (() => void) | null
}

interface ToolbarButtonProps {
  /** Identifies the button in the DOM, so the arrow keys can name the tab stop. */
  controlKey: string
  label: string
  pressed: boolean
  disabled?: boolean
  tabIndex: number
  onPress: () => void
  children: ReactNode
}

/**
 * One toolbar control.
 *
 * `onMouseDown` is prevented because a `mousedown` anywhere outside the
 * contenteditable takes focus off it, and ProseMirror throws the selection away
 * with the focus. Preventing the default keeps the caret exactly where the rep
 * left it, which is the whole reason the button is worth pressing.
 */
function ToolbarButton({
  controlKey,
  label,
  pressed,
  disabled,
  tabIndex,
  onPress,
  children,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-control={controlKey}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      tabIndex={tabIndex}
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={onPress}
      // Pressed reads as the selected-surface shade, not as a second color.
      // Hover shifts the shade; it never changes color family.
      className={pressed ? 'bg-accent border-accent' : undefined}
    >
      {children}
    </Button>
  )
}

/**
 * The compact formatting toolbar: bold, italic, underline, bullet list,
 * numbered list, and link.
 *
 * It is a real ARIA `toolbar`, so it takes ONE tab stop and the arrow keys move
 * between the buttons inside it. That matters in a composer: `Tab` out of the
 * body has to reach Send, not walk every icon first.
 */
export function RichTextEditorToolbar({ editor, onRequestLink }: RichTextEditorToolbarProps) {
  const rowRef = useRef<HTMLDivElement>(null)

  const state = useEditorState({
    editor,
    selector: ({ editor: current }): ToolbarState => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      link: current.isActive('link'),
    }),
  })

  // The roving tab stop, held by name rather than by position: the link button
  // can be disabled, and an index into a list whose members come and go is the
  // classic way a toolbar ends up with no tab stop at all. Which control holds
  // it is the last one focused, so a rep who arrows to the list button and tabs
  // away comes back to the list button.
  const [focusKey, setFocusKey] = useState('bold')

  function enabledButtons(): HTMLButtonElement[] {
    const row = rowRef.current
    if (!row) return []
    return Array.from(row.querySelectorAll('button')).filter((button) => !button.disabled)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return

    const buttons = enabledButtons()
    if (buttons.length === 0) return

    const current = buttons.findIndex((button) => button === document.activeElement)
    const from = current === -1 ? 0 : current

    let next = from
    if (event.key === 'ArrowRight') next = (from + 1) % buttons.length
    if (event.key === 'ArrowLeft') next = (from - 1 + buttons.length) % buttons.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = buttons.length - 1

    event.preventDefault()
    buttons[next].focus()
    const key = buttons[next].dataset.control
    if (key) setFocusKey(key)
  }

  function toggleLink() {
    // Inside a link already: the button's job is to take it off, and that needs
    // no URL from anyone. Outside one, a URL has to come from the host.
    if (state.link) {
      editor.chain().focus().unsetLink().run()
      return
    }
    onRequestLink?.()
  }

  const controls = [
    {
      key: 'bold',
      label: 'Bold',
      pressed: state.bold,
      icon: <Bold size={16} />,
      onPress: () => editor.chain().focus().toggleBold().run(),
      disabled: false,
    },
    {
      key: 'italic',
      label: 'Italic',
      pressed: state.italic,
      icon: <Italic size={16} />,
      onPress: () => editor.chain().focus().toggleItalic().run(),
      disabled: false,
    },
    {
      key: 'underline',
      label: 'Underline',
      pressed: state.underline,
      icon: <Underline size={16} />,
      onPress: () => editor.chain().focus().toggleUnderline().run(),
      disabled: false,
    },
    {
      key: 'bulletList',
      label: 'Bulleted list',
      pressed: state.bulletList,
      icon: <List size={16} />,
      onPress: () => editor.chain().focus().toggleBulletList().run(),
      disabled: false,
    },
    {
      key: 'orderedList',
      label: 'Numbered list',
      pressed: state.orderedList,
      icon: <ListOrdered size={16} />,
      onPress: () => editor.chain().focus().toggleOrderedList().run(),
      disabled: false,
    },
    {
      key: 'link',
      label: state.link ? 'Remove link' : 'Add link',
      pressed: state.link,
      icon: <Link2 size={16} />,
      onPress: toggleLink,
      disabled: !state.link && onRequestLink === null,
    },
  ]

  // A disabled control cannot hold the tab stop, or the toolbar drops out of the
  // tab order entirely. Fall back to the first enabled one.
  const focusable = controls.filter((control) => !control.disabled)
  const tabStopKey = focusable.some((control) => control.key === focusKey)
    ? focusKey
    : focusable[0].key

  return (
    <div
      ref={rowRef}
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex shrink-0 items-center gap-1 border-t border-border bg-muted px-2 py-1"
    >
      {controls.map((control) => (
        <ToolbarButton
          key={control.key}
          controlKey={control.key}
          label={control.label}
          pressed={control.pressed}
          disabled={control.disabled}
          tabIndex={control.key === tabStopKey ? 0 : -1}
          onPress={control.onPress}
        >
          {control.icon}
        </ToolbarButton>
      ))}
    </div>
  )
}
