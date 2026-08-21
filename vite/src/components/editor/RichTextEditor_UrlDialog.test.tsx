import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RichTextEditorUrlDialog } from './RichTextEditor_UrlDialog'
import { LINK_URL_MESSAGES, normalizeLinkUrl } from './linkUrl'
import { EDITOR_ALLOWED_SCHEMES } from './editorExtensions'
import type { LinkRequest } from './RichTextEditor'

/** A link request with a spy on `apply`, the way `RichTextEditor` raises one. */
function makeRequest(over: { href?: string | null; text?: string } = {}) {
  const apply = vi.fn()
  const request: LinkRequest = {
    href: over.href ?? null,
    text: over.text ?? '',
    apply,
  }
  return { request, apply }
}

function openWith(over: { href?: string | null; text?: string } = {}) {
  const { request, apply } = makeRequest(over)
  const onClose = vi.fn()
  render(<RichTextEditorUrlDialog request={request} onClose={onClose} />)
  return { apply, onClose, user: userEvent.setup() }
}

const urlField = () => screen.getByLabelText('Web address')
const textField = () => screen.getByLabelText('Text')

describe('normalizeLinkUrl — what is accepted', () => {
  it.each([
    ['https://acme.com', 'https://acme.com'],
    ['https://acme.com/quote?id=7#terms', 'https://acme.com/quote?id=7#terms'],
    ['http://acme.com', 'http://acme.com'],
    ['HTTPS://Acme.com', 'HTTPS://Acme.com'],
    ['mailto:ann@acme.com', 'mailto:ann@acme.com'],
    ['MAILTO:ann@acme.com', 'MAILTO:ann@acme.com'],
  ])('keeps %s as it was typed', (typed, expected) => {
    expect(normalizeLinkUrl(typed)).toEqual({ ok: true, href: expected })
  })

  it.each([
    ['acme.com', 'https://acme.com'],
    ['  acme.com  ', 'https://acme.com'],
    ['acme.com/quote', 'https://acme.com/quote'],
    ['www.acme.com', 'https://www.acme.com'],
  ])('gives %s the https scheme, never http', (typed, expected) => {
    expect(normalizeLinkUrl(typed)).toEqual({ ok: true, href: expected })
  })

  it('never returns a scheme the server would strip', () => {
    const accepted = [
      'acme.com',
      'https://acme.com',
      'http://acme.com',
      'mailto:ann@acme.com',
      'HTTPS://Acme.com',
    ]

    for (const typed of accepted) {
      const result = normalizeLinkUrl(typed)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(result.href)![1].toLowerCase()
      expect(EDITOR_ALLOWED_SCHEMES as readonly string[]).toContain(scheme)
    }
  })
})

describe('normalizeLinkUrl — what is refused, and said out loud', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\r\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://acme.com/x',
    'tel:+15555550123',
  ])('refuses %j and names the schemes that work', (typed) => {
    expect(normalizeLinkUrl(typed)).toEqual({
      ok: false,
      message: LINK_URL_MESSAGES.scheme,
    })
  })

  it.each(['', '   ', '\t\n'])('asks for a web address when given %j', (typed) => {
    expect(normalizeLinkUrl(typed)).toEqual({ ok: false, message: LINK_URL_MESSAGES.empty })
  })

  it.each([
    // Inherits the page's scheme. The server drops it, so it is refused here.
    '//evil.example/x',
    '////evil.example',
    // Valid URLs, useless links.
    'https://',
    'mailto:',
    'http://',
  ])('refuses %j as not a usable address', (typed) => {
    expect(normalizeLinkUrl(typed)).toEqual({ ok: false, message: LINK_URL_MESSAGES.invalid })
  })
})

describe('RichTextEditorUrlDialog', () => {
  it('renders nothing until there is a request', () => {
    const onClose = vi.fn()
    render(<RichTextEditorUrlDialog request={null} onClose={onClose} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on an empty caret with both fields blank', () => {
    openWith()

    expect(screen.getByRole('heading', { name: 'Add link' })).toBeInTheDocument()
    expect(urlField()).toHaveValue('')
    expect(textField()).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument()
  })

  it('sends the text and the https-prefixed URL back to the editor', async () => {
    const { apply, onClose, user } = openWith()

    await user.type(textField(), 'Acme pricing')
    await user.type(urlField(), 'acme.com/pricing')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(apply).toHaveBeenCalledWith('https://acme.com/pricing', 'Acme pricing')
    expect(onClose).toHaveBeenCalled()
  })

  it('prefills the selected words so a selection keeps its own text', async () => {
    const { apply, user } = openWith({ text: 'our pricing page' })

    expect(textField()).toHaveValue('our pricing page')

    await user.type(urlField(), 'acme.com')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(apply).toHaveBeenCalledWith('https://acme.com', 'our pricing page')
  })

  it('submits on Enter, because a two-field dialog is a form', async () => {
    const { apply, user } = openWith()

    await user.type(urlField(), 'acme.com{Enter}')

    expect(apply).toHaveBeenCalledWith('https://acme.com', '')
  })

  it('refuses a javascript: URL with a message and stays open', async () => {
    const { apply, onClose, user } = openWith()

    await user.type(urlField(), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('alert')).toHaveTextContent(LINK_URL_MESSAGES.scheme)
    expect(urlField()).toHaveAttribute('aria-invalid', 'true')
    // Nothing was applied and nothing was closed: refusing silently would leave
    // the rep looking at text that reads like a link and is not one.
    expect(apply).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Add link' })).toBeInTheDocument()
  })

  it('clears the message as soon as the rep edits the URL, then accepts the fix', async () => {
    const { apply, user } = openWith()

    await user.type(urlField(), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.clear(urlField())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.type(urlField(), 'acme.com')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(apply).toHaveBeenCalledWith('https://acme.com', '')
  })

  it('asks for a web address rather than applying an empty one', async () => {
    const { apply, user } = openWith()

    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('alert')).toHaveTextContent(LINK_URL_MESSAGES.empty)
    expect(apply).not.toHaveBeenCalled()
  })

  it('opens on an existing link with its URL and words filled in', () => {
    openWith({ href: 'https://old.example/quote', text: 'last quote' })

    expect(screen.getByRole('heading', { name: 'Edit link' })).toBeInTheDocument()
    expect(urlField()).toHaveValue('https://old.example/quote')
    expect(textField()).toHaveValue('last quote')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('saves an edited URL against the same words', async () => {
    const { apply, user } = openWith({ href: 'https://old.example', text: 'last quote' })

    await user.clear(urlField())
    await user.type(urlField(), 'acme.com/new')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(apply).toHaveBeenCalledWith('https://acme.com/new', 'last quote')
  })

  it('removes a link without needing a valid URL', async () => {
    const { apply, onClose, user } = openWith({ href: 'https://old.example', text: 'last quote' })

    await user.clear(urlField())
    await user.click(screen.getByRole('button', { name: 'Remove link' }))

    expect(apply).toHaveBeenCalledWith(null)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Cancel without touching the document', async () => {
    const { apply, onClose, user } = openWith()

    await user.type(urlField(), 'acme.com')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(apply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const { apply, onClose, user } = openWith()

    await user.keyboard('{Escape}')

    expect(apply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
