import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { RichTextEditor, type LinkRequest } from './RichTextEditor'
import { EDITOR_ALLOWED_TAGS, hasAllowedScheme } from './editorExtensions'

/**
 * ProseMirror measures the document with `Range.getClientRects` whenever it maps
 * a selection back to the DOM. jsdom implements neither, and without them the
 * editor throws on the first click instead of failing a real assertion. Local to
 * this file rather than in `src/test/setup.ts`: nothing else in the app needs
 * them, and a global stub is a global lie about what jsdom can do.
 */
beforeAll(() => {
  if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  }
  if (typeof Element !== 'undefined' && !Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  }
})

/** The editable region, as a screen reader finds it. */
function bodyOf(label = 'Message'): HTMLElement {
  return screen.getByRole('textbox', { name: label })
}

/**
 * Select the whole document, the way a rep would.
 *
 * `Mod-A` is ProseMirror's own `selectAll`, so this exercises the editor's real
 * keymap rather than reaching past it into the instance. Every mark test needs a
 * selection: toggling a mark on an empty caret only sets a pending mark, which
 * changes no HTML and reports nothing upward.
 */
async function selectAll(user: ReturnType<typeof userEvent.setup>) {
  bodyOf().focus()
  await user.keyboard('{Control>}a{/Control}')
}

/** The last HTML the editor reported upward. */
function lastHtml(onChange: ReturnType<typeof vi.fn>): string {
  expect(onChange).toHaveBeenCalled()
  return onChange.mock.calls.at(-1)![0] as string
}

describe('RichTextEditor', () => {
  it('seeds from initialHtml and shows the toolbar', () => {
    render(<RichTextEditor label="Message" initialHtml="<p>Hello there</p>" />)

    expect(bodyOf()).toHaveTextContent('Hello there')
    for (const name of ['Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Add link']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // Exactly five. A sixth button is a question for the spec, not a patch.
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('does not report the seed upward', () => {
    const onChange = vi.fn()
    render(<RichTextEditor label="Message" initialHtml="<p>Hello</p>" onChange={onChange} />)

    // Opening a card is not editing it. A host compares against its own saved
    // copy, and a first-render write would be a wasted PATCH on every open.
    expect(onChange).not.toHaveBeenCalled()
  })

  /**
   * The rule the whole module lives or dies by, tested at the only level a unit
   * test can reach it: a parent that hands back its saved copy must not be able
   * to replace what the rep is typing. No test can see a caret move, but this
   * one proves the prop can never get far enough to move it.
   */
  it('ignores initialHtml after mount, and says so in dev', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    function Host() {
      const [saved, setSaved] = useState('<p>Typed by the rep</p>')
      return (
        <>
          <button type="button" onClick={() => setSaved('<p>Echoed by the server</p>')}>
            Save came back
          </button>
          <RichTextEditor label="Message" initialHtml={saved} />
        </>
      )
    }

    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Save came back' }))

    expect(bodyOf()).toHaveTextContent('Typed by the rep')
    expect(bodyOf()).not.toHaveTextContent('Echoed by the server')
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('`initialHtml` changed after mount')),
    )
  })

  it('shows the placeholder until there is content', async () => {
    const user = userEvent.setup()
    render(<RichTextEditor label="Message" placeholder="Write a message" />)

    const empty = bodyOf().querySelector('p')
    expect(empty).toHaveAttribute('data-placeholder', 'Write a message')
    expect(empty).toHaveClass('is-editor-empty')

    bodyOf().focus()
    await user.keyboard('Hi')

    await waitFor(() =>
      expect(bodyOf().querySelector('p')).not.toHaveClass('is-editor-empty'),
    )
  })

  describe('marks round-trip through the toolbar', () => {
    it.each([
      { button: 'Bold', tag: 'strong' },
      { button: 'Italic', tag: 'em' },
    ])('$button produces <$tag>', async ({ button, tag }) => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor label="Message" initialHtml="<p>Formatted</p>" onChange={onChange} />,
      )

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: button }))

      await waitFor(() => expect(lastHtml(onChange)).toContain(`<${tag}>Formatted</${tag}>`))
    })

    it.each([
      { button: 'Bulleted list', tag: 'ul' },
      { button: 'Numbered list', tag: 'ol' },
    ])('$button produces <$tag><li>', async ({ button, tag }) => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<RichTextEditor label="Message" initialHtml="<p>One</p>" onChange={onChange} />)

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: button }))

      await waitFor(() => {
        const html = lastHtml(onChange)
        expect(html).toContain(`<${tag}>`)
        expect(html).toContain('<li>')
      })
    })

    it.each([
      { keys: '{Control>}b{/Control}', tag: 'strong' },
      { keys: '{Control>}i{/Control}', tag: 'em' },
    ])('the $keys shortcut produces <$tag>', async ({ keys, tag }) => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor label="Message" initialHtml="<p>Formatted</p>" onChange={onChange} />,
      )

      await selectAll(user)
      await user.keyboard(keys)

      await waitFor(() => expect(lastHtml(onChange)).toContain(`<${tag}>Formatted</${tag}>`))
    })

    /**
     * Everything the editor can emit has to survive the server's allow-list in
     * `server/src/lib/sanitizeHtml.ts`. A mark that looks applied and is deleted
     * on save is the worst shape this bug takes, so the tags are checked against
     * the copy of that list the editor is configured from.
     */
    it('emits only tags the server allow-list keeps', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml="<p>Alpha</p><ul><li>Beta</li></ul>"
          onChange={onChange}
        />,
      )

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: 'Bold' }))

      await waitFor(() => expect(onChange).toHaveBeenCalled())
      const tags = [...lastHtml(onChange).matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((m) =>
        m[1].toLowerCase(),
      )
      expect(tags.length).toBeGreaterThan(0)
      for (const tag of tags) {
        expect(EDITOR_ALLOWED_TAGS as readonly string[]).toContain(tag)
      }
    })

    it('drops a pasted heading to a paragraph rather than emitting <h1>', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          // Headings, styles, and classes are all off the allow-list. The editor
          // is configured with no heading extension at all, so the text survives
          // and the tag does not.
          initialHtml='<h1 class="x" style="color:red">Big</h1>'
          onChange={onChange}
        />,
      )

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: 'Bold' }))

      await waitFor(() => {
        const html = lastHtml(onChange)
        expect(html).not.toContain('<h1')
        expect(html).not.toContain('style=')
        expect(html).not.toContain('class=')
        expect(html).toContain('Big')
      })
    })
  })

  describe('the toolbar follows the caret', () => {
    it('flips aria-pressed when the mark under the caret changes', async () => {
      const user = userEvent.setup()
      render(<RichTextEditor label="Message" initialHtml="<p>Formatted</p>" />)

      const bold = screen.getByRole('button', { name: 'Bold' })
      expect(bold).toHaveAttribute('aria-pressed', 'false')

      await selectAll(user)
      await user.click(bold)

      await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'))
    })

    it('starts every control unpressed on an empty document', () => {
      render(<RichTextEditor label="Message" />)

      for (const name of ['Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Add link']) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
      }
    })

    it('takes one tab stop and moves between buttons with the arrow keys', async () => {
      const user = userEvent.setup()
      render(<RichTextEditor label="Message" />)

      const bold = screen.getByRole('button', { name: 'Bold' })
      const italic = screen.getByRole('button', { name: 'Italic' })
      expect(bold).toHaveAttribute('tabindex', '0')
      expect(italic).toHaveAttribute('tabindex', '-1')

      bold.focus()
      await user.keyboard('{ArrowRight}')
      expect(italic).toHaveFocus()
    })
  })

  describe('the link control', () => {
    it('is disabled when no host handles a link request', () => {
      render(<RichTextEditor label="Message" initialHtml="<p>Plain</p>" />)

      // Visibly disabled beats a live-looking control that does nothing
      // (CLAUDE.md → Verification). The URL dialog fills this in.
      expect(screen.getByRole('button', { name: 'Add link' })).toBeDisabled()
    })

    it('asks the host for a URL and applies what it gets back', async () => {
      const onChange = vi.fn()
      const onRequestLink = vi.fn((request: LinkRequest) => request.apply('https://acme.example'))
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml="<p>Acme</p>"
          onChange={onChange}
          onRequestLink={onRequestLink}
        />,
      )

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: 'Add link' }))

      expect(onRequestLink).toHaveBeenCalledWith(
        expect.objectContaining({ href: null, apply: expect.any(Function) }),
      )
      await waitFor(() => {
        const html = lastHtml(onChange)
        expect(html).toContain('href="https://acme.example"')
        expect(html).toContain('rel="noopener noreferrer"')
        expect(html).toContain('target="_blank"')
      })
    })

    it('raises the same request on Cmd/Ctrl+K', async () => {
      const onRequestLink = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml="<p>Acme</p>"
          onRequestLink={onRequestLink}
        />,
      )

      await selectAll(user)
      await user.keyboard('{Control>}k{/Control}')

      expect(onRequestLink).toHaveBeenCalledTimes(1)
    })

    it('removes a link without asking the host for anything', async () => {
      const onChange = vi.fn()
      const onRequestLink = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml='<p><a href="https://acme.example">Acme</a></p>'
          onChange={onChange}
          onRequestLink={onRequestLink}
        />,
      )

      // Inside a link, the button's job is to take it off — no URL needed.
      const remove = await screen.findByRole('button', { name: 'Remove link' })
      await selectAll(user)
      await user.click(remove)

      await waitFor(() => expect(lastHtml(onChange)).not.toContain('<a'))
      expect(onRequestLink).not.toHaveBeenCalled()
    })

    it('hands the host the words the rep selected', async () => {
      const seen: LinkRequest[] = []
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml="<p>Acme pricing</p>"
          onRequestLink={(request) => seen.push(request)}
        />,
      )

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: 'Add link' }))

      expect(seen[0].text).toBe('Acme pricing')
      expect(seen[0].href).toBeNull()
    })

    it('hands the host the whole link when the caret sits inside one', async () => {
      const seen: LinkRequest[] = []
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml='<p><a href="https://acme.example">Acme pricing</a></p>'
          onRequestLink={(request) => seen.push(request)}
        />,
      )

      // No selection at all. `Cmd/Ctrl+K` rather than the button, because inside
      // a link the button's job is to remove it.
      bodyOf().focus()
      await user.keyboard('{Control>}k{/Control}')

      expect(seen[0].href).toBe('https://acme.example')
      expect(seen[0].text).toBe('Acme pricing')
    })

    it('inserts the text as a link when the caret has nothing to mark', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          onChange={onChange}
          onRequestLink={(request) => request.apply('https://acme.example', 'Acme pricing')}
        />,
      )

      bodyOf().focus()
      await user.keyboard('{Control>}k{/Control}')

      await waitFor(() => {
        const html = lastHtml(onChange)
        expect(html).toContain('href="https://acme.example"')
        expect(html).toContain('>Acme pricing</a>')
      })
    })

    it('falls back to the URL when the host sends no text at all', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          onChange={onChange}
          onRequestLink={(request) => request.apply('https://acme.example', '')}
        />,
      )

      bodyOf().focus()
      await user.keyboard('{Control>}k{/Control}')

      // Never an empty `<a>`, which is invisible and unclickable.
      await waitFor(() => expect(lastHtml(onChange)).toContain('>https://acme.example</a>'))
    })

    it('replaces the selection when the host changes the text', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml="<p>Acme</p>"
          onChange={onChange}
          onRequestLink={(request) => request.apply('https://acme.example', 'Acme pricing')}
        />,
      )

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: 'Add link' }))

      await waitFor(() => {
        const html = lastHtml(onChange)
        expect(html).toContain('>Acme pricing</a>')
        expect(html).not.toContain('>Acme</a>')
      })
    })

    it('marks the selection in place when the text is unchanged, keeping its bold', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <RichTextEditor
          label="Message"
          initialHtml="<p><strong>Acme</strong></p>"
          onChange={onChange}
          onRequestLink={(request) => request.apply('https://acme.example', request.text)}
        />,
      )

      await selectAll(user)
      await user.click(screen.getByRole('button', { name: 'Add link' }))

      await waitFor(() => {
        const html = lastHtml(onChange)
        expect(html).toContain('href="https://acme.example"')
        expect(html).toContain('<strong>')
      })
    })
  })

  describe('hasAllowedScheme', () => {
    it.each(['https://acme.example', 'http://acme.example', 'mailto:ann@acme.example'])(
      'allows %s',
      (url) => expect(hasAllowedScheme(url)).toBe(true),
    )

    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'ftp://acme.example/x',
    ])('refuses %s', (url) => expect(hasAllowedScheme(url)).toBe(false))

    it('allows a bare host, which the default protocol turns into https', () => {
      expect(hasAllowedScheme('acme.example/pricing')).toBe(true)
    })
  })
})
