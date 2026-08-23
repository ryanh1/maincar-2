import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SanitizedHtml } from './SanitizedHtml'
import {
  SANITIZED_ALLOWED_SCHEMES,
  SANITIZED_ALLOWED_TAGS,
  SANITIZED_ANCHOR_ATTR,
  SANITIZED_MENTION_ATTR,
  sanitizeStoredHtml,
} from './sanitizeStoredHtml'

/**
 * Render a stored string the way the app does, and hand back the element it
 * landed in.
 *
 * Everything here goes through the real component rather than through
 * `sanitizeStoredHtml` alone, because the thing being tested is what ends up in
 * the DOM. A sanitiser that returns a safe string and a component that renders a
 * different one would pass a string-only test and still fire.
 */
function renderStored(html: string): HTMLElement {
  const { container } = render(<SanitizedHtml html={html} />)
  return container.firstElementChild as HTMLElement
}

/** Every element in the subtree, by lower-case tag name. */
function tagsIn(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('*')).map((node) => node.tagName.toLowerCase())
}

/** Every attribute name present anywhere in the subtree. */
function attrsIn(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('*')).flatMap((node) =>
    Array.from(node.attributes).map((attribute) => attribute.name.toLowerCase()),
  )
}

/**
 * The payloads. Every one of them is a real, published XSS vector or a real
 * paste artefact, and the block below asserts the same invariants against all of
 * them at once. Adding a row is how a newly-learned attack gets pinned.
 */
const ATTACKS: Array<[name: string, payload: string]> = [
  ['a plain script tag', '<script>alert(1)</script>'],
  ['a script tag in caps', '<SCRIPT>alert(1)</SCRIPT>'],
  ['a script tag in mixed case', '<ScRiPt>alert(1)</ScRiPt>'],
  ['a nested script tag that survives one naive pass', '<scr<script>ipt>alert(1)</script>'],
  ['a script tag with an attribute', '<script type="text/javascript">alert(1)</script>'],
  ['an image with an error handler', '<img src=x onerror=alert(1)>'],
  ['an image with no space before the attribute', '<img/src="x"onerror=alert(1)>'],
  ['an event handler on an allowed tag', '<p onclick="alert(1)">Click me</p>'],
  ['an event handler in caps on an allowed tag', '<p ONMOUSEOVER="alert(1)">Hover me</p>'],
  ['a javascript: link', '<a href="javascript:alert(1)">Click</a>'],
  ['a javascript: link in mixed case', '<a href="JaVaScRiPt:alert(1)">Click</a>'],
  ['a javascript: link split by a tab entity', '<a href="jav&#x09;ascript:alert(1)">Click</a>'],
  ['a javascript: link split by a newline entity', '<a href="jav&#10;ascript:alert(1)">Click</a>'],
  ['an entity-encoded javascript: link', '<a href="&#106;avascript:alert(1)">Click</a>'],
  ['a hex-entity-encoded javascript: link', '<a href="&#x6a;avascript:alert(1)">Click</a>'],
  ['a vbscript: link', '<a href="vbscript:msgbox(1)">Click</a>'],
  ['a data: URL link', '<a href="data:text/html,<script>alert(1)</script>">Click</a>'],
  ['a base64 data: URL link', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Click</a>'],
  ['a protocol-relative link', '<a href="//evil.example/x">Click</a>'],
  ['a file: link', '<a href="file:///etc/passwd">Click</a>'],
  ['an iframe', '<iframe src="https://evil.example"></iframe>'],
  ['an iframe with srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['an svg with a script inside', '<svg><script>alert(1)</script></svg>'],
  ['an svg with a load handler', '<svg onload="alert(1)"></svg>'],
  ['an svg animate vector', '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>'],
  ['a foreignObject wrapping markup', '<svg><foreignObject><body><img src=x onerror=alert(1)></body></foreignObject></svg>'],
  [
    'the mglyph mutation vector',
    '<math><mtext><table><mglyph><style><!--</style><img src onerror=alert(1)>',
  ],
  ['a noscript mutation vector', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ['a template holding markup', '<template><img src=x onerror=alert(1)></template>'],
  ['an object', '<object data="data:text/html,<script>alert(1)</script>"></object>'],
  ['an embed', '<embed src="https://evil.example/x.swf">'],
  ['a style block', '<style>body { background: url("javascript:alert(1)") }</style>'],
  ['a base tag', '<base href="https://evil.example/">'],
  ['a form with an input', '<form action="https://evil.example"><input name="password"></form>'],
  ['a textarea holding markup', '<textarea><img src=x onerror=alert(1)></textarea>'],
  ['an html comment holding a conditional', '<!--[if IE]><script>alert(1)</script><![endif]-->'],
  ['a meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
]

describe('sanitizeStoredHtml — the allow-list', () => {
  /**
   * The client list and the server list are two copies of one rule, and the
   * client's may never be the looser of the two. The literals below are pinned
   * to `server/src/lib/sanitizeHtml.ts`; if that file changes, this test is what
   * says so.
   */
  it('matches the server allow-list exactly', () => {
    expect([...SANITIZED_ALLOWED_TAGS]).toEqual([
      'p',
      'br',
      'strong',
      'em',
      'u',
      'a',
      'span',
      'ul',
      'ol',
      'li',
    ])
    expect([...SANITIZED_ANCHOR_ATTR]).toEqual(['href', 'target', 'rel'])
    expect([...SANITIZED_MENTION_ATTR]).toEqual(['data-type', 'data-id', 'data-label', 'data-mention-kind'])
    expect([...SANITIZED_ALLOWED_SCHEMES]).toEqual(['http', 'https', 'mailto'])
  })

  it('keeps every allowed tag', () => {
    const stored =
      '<p><strong>Bold</strong> <em>italic</em> <u>underline</u><br>and a ' +
      '<a href="https://acme.com">link</a> <span data-type="mention" data-id="user-1" data-label="Ada" data-mention-kind="teammate">@Ada</span></p><ul><li>one</li></ul><ol><li>two</li></ol>'

    const out = renderStored(stored)

    expect(new Set(tagsIn(out))).toEqual(new Set([...SANITIZED_ALLOWED_TAGS]))
    expect(out).toHaveTextContent('Bold italic underline')
  })

  it('unwraps a disallowed tag but keeps the rep’s words', () => {
    const out = renderStored('<div>Hello <span>there</span></div>')

    expect(out).toHaveTextContent('Hello there')
    expect(tagsIn(out)).toEqual(['span'])
  })

  it('is idempotent, because a draft round-trips on every autosave', () => {
    const stored = '<p>Hi <a href="https://acme.com" target="_blank">Acme</a></p>'
    const once = sanitizeStoredHtml(stored)

    expect(sanitizeStoredHtml(once)).toBe(once)
  })
})

describe('sanitizeStoredHtml — attacks', () => {
  it.each(ATTACKS)('neutralises %s', (_name, payload) => {
    const out = renderStored(payload)

    // 1. Nothing outside the allow-list survives as an element.
    for (const tag of tagsIn(out)) {
      expect(SANITIZED_ALLOWED_TAGS as readonly string[]).toContain(tag)
    }

    // 2. No handler, no style, no class, no id — only the three anchor
    //    attributes exist at all.
    for (const name of attrsIn(out)) {
      expect(SANITIZED_ANCHOR_ATTR as readonly string[]).toContain(name)
    }

    // 3. Nothing executable is left in any href, and the browser's own parse of
    //    the attribute is what is inspected, so an entity-encoded scheme is read
    //    as the scheme it decodes to.
    for (const anchor of Array.from(out.querySelectorAll('a'))) {
      const href = anchor.getAttribute('href')
      if (href === null) continue
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1].toLowerCase()
      expect(SANITIZED_ALLOWED_SCHEMES as readonly string[]).toContain(scheme ?? 'http')
    }

    // 4. And the crude check, which catches a payload that slipped through as
    //    text in a place the three above do not look.
    expect(out.innerHTML.toLowerCase()).not.toContain('<script')
    expect(out.innerHTML.toLowerCase()).not.toContain('javascript:')
    expect(out.innerHTML.toLowerCase()).not.toContain('onerror')
  })

  it('throws away the text inside a script rather than leaving alert(1) in the email', () => {
    expect(sanitizeStoredHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>')
    expect(sanitizeStoredHtml('<textarea>alert(1)</textarea>')).toBe('')
  })

  it('drops an href a scheme check would refuse but leaves the words', () => {
    const out = renderStored('<a href="javascript:alert(1)">Click me</a>')

    expect(out).toHaveTextContent('Click me')
    expect(out.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  it('drops a relative href, which is stricter than the server and safe to be', () => {
    const out = renderStored('<a href="/pricing">Pricing</a>')

    expect(out.querySelector('a')?.hasAttribute('href')).toBe(false)
  })
})

describe('sanitizeStoredHtml — links', () => {
  it('keeps an allowed scheme untouched', () => {
    expect(sanitizeStoredHtml('<a href="https://acme.com/x?q=1">x</a>')).toContain(
      'href="https://acme.com/x?q=1"',
    )
    expect(sanitizeStoredHtml('<a href="mailto:ann@acme.com">x</a>')).toContain(
      'href="mailto:ann@acme.com"',
    )
    expect(sanitizeStoredHtml('<a href="http://acme.com">x</a>')).toContain(
      'href="http://acme.com"',
    )
  })

  it('forces rel="noopener noreferrer" on anything that opens a new tab', () => {
    const out = renderStored('<a href="https://acme.com" target="_blank">x</a>')

    expect(out.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('rewrites a rel the sender chose', () => {
    const out = renderStored('<a href="https://acme.com" target="_blank" rel="opener">x</a>')

    expect(out.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('strips the anchor attributes off a tag that is not an anchor', () => {
    // DOMPurify's `ALLOWED_ATTR` has no per-tag notion, so without the hook in
    // SanitizedHtml.tsx this would keep `href` on a paragraph — inert, but
    // looser than the server, which is the one thing this file may not be.
    const out = renderStored('<p href="https://evil.example" target="_blank" rel="opener">Hi</p>')

    expect(attrsIn(out)).toEqual([])
    expect(out).toHaveTextContent('Hi')
  })

  it('preserves only a complete, valid structured mention chip', () => {
    const valid = sanitizeStoredHtml(
      '<span data-type="mention" data-id="user-1" data-label="Ada" data-mention-kind="teammate">@Ada</span>',
    )
    expect(valid).toContain('data-type="mention"')
    expect(valid).toContain('data-id="user-1"')
    expect(sanitizeStoredHtml('<span data-id="user-1" data-mention-kind="teammate">@Ada</span>')).toBe('<span>@Ada</span>')
  })
})

describe('sanitizeStoredHtml — pasted formatting', () => {
  it('reduces a Google Docs paste to allowed tags with no styling', () => {
    const googleDocs =
      '<b style="font-weight:normal" id="docs-internal-guid-9f1">' +
      '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">' +
      '<span style="font-size:11pt;font-family:Arial;color:#000000;">Quote for </span>' +
      '<span style="font-weight:700;">Acme</span></p></b>'

    const out = renderStored(googleDocs)

    expect(out).toHaveTextContent('Quote for Acme')
    expect(attrsIn(out)).toEqual([])
    for (const tag of tagsIn(out)) {
      expect(SANITIZED_ALLOWED_TAGS as readonly string[]).toContain(tag)
    }
  })

  it('reduces a Word paste to allowed tags, losing font and mso markup', () => {
    const word =
      '<!--StartFragment--><p class="MsoNormal" style="margin:0in;font-size:11pt;">' +
      '<font face="Calibri" size="3" color="#1F497D">Following up on the quote' +
      '<o:p></o:p></font></p><!--EndFragment-->'

    const out = renderStored(word)

    expect(out).toHaveTextContent('Following up on the quote')
    expect(attrsIn(out)).toEqual([])
    expect(tagsIn(out)).not.toContain('font')
  })
})

describe('SanitizedHtml', () => {
  it('renders nothing for null and for undefined', () => {
    const { container: withNull } = render(<SanitizedHtml html={null} />)
    expect(withNull.firstElementChild?.innerHTML).toBe('')

    const { container: withUndefined } = render(<SanitizedHtml html={undefined} />)
    expect(withUndefined.firstElementChild?.innerHTML).toBe('')
  })

  it('renders the sanitised markup as real elements, not as text', () => {
    render(<SanitizedHtml html='<p>Hi <a href="https://acme.com">Acme</a></p>' />)

    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      'https://acme.com',
    )
  })

  it('takes a className', () => {
    const { container } = render(<SanitizedHtml html="<p>Hi</p>" className="tiptap text-sm" />)

    expect(container.firstElementChild).toHaveClass('tiptap', 'text-sm')
  })
})
