// Unit tests for the server-side HTML allow-list (MAI-78 / EC-12).
//
// This file is a security test, so it is written as an attack list rather than a
// feature list. The happy path here is two tests long; everything else is a
// payload that has really been used to land stored XSS somewhere, and the
// assertion is that it does not survive the write path.
//
// Two rules the assertions follow:
//
//   - Assert on what is GONE, not only on what came back. A test that checks the
//     output equals some expected string passes just as happily when the
//     sanitiser is replaced by something subtly weaker, as long as that one
//     string still matches. So the payload tests assert the absence of the thing
//     that executes — the handler, the scheme, the tag.
//   - Every payload is also checked for idempotency, because a draft body is
//     re-sanitised on every autosave. A sanitiser that mangles its own output
//     would corrupt an email a keystroke at a time.
import { describe, expect, it } from 'vitest'

import {
  ALLOWED_ATTR,
  ALLOWED_SCHEMES,
  ALLOWED_TAGS,
  sanitizeOptionalRichTextHtml,
  sanitizeRichTextHtml,
} from '../sanitizeHtml.js'

/** Sanitise, and assert the second pass changes nothing. Returns the output. */
function clean(html: string): string {
  const once = sanitizeRichTextHtml(html)
  expect(sanitizeRichTextHtml(once)).toBe(once)
  return once
}

describe('the allow-list itself', () => {
  it('permits exactly the marks the composer toolbar can produce', () => {
    expect(ALLOWED_TAGS).toEqual(['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li'])
  })

  it('gives attributes to `a` and to nothing else', () => {
    expect(ALLOWED_ATTR).toEqual({ a: ['href', 'target', 'rel'] })
  })

  it('permits only schemes that cannot execute', () => {
    expect(ALLOWED_SCHEMES).toEqual(['http', 'https', 'mailto'])
  })
})

describe('what a rep actually writes', () => {
  it('keeps bold, italic, underline and a link untouched', () => {
    const html =
      '<p>Hi <strong>Ann</strong>, <em>thanks</em> and <u>welcome</u>. ' +
      '<a href="https://acme.example/pricing">Pricing</a></p>'
    expect(clean(html)).toBe(html)
  })

  it('keeps both list types untouched', () => {
    const html = '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>'
    expect(clean(html)).toBe(html)
  })

  it('keeps a mailto link, because that is how a rep links their own address', () => {
    expect(clean('<a href="mailto:ann@acme.example">Ann</a>')).toBe(
      '<a href="mailto:ann@acme.example">Ann</a>',
    )
  })

  it('leaves already-escaped entities alone rather than double-escaping them', () => {
    // Round-tripping is what makes this safe to run on every autosave: `&amp;`
    // must not creep towards `&amp;amp;` one save at a time.
    const html = '<p>5 &lt; 6 &amp; 7 &gt; 2</p>'
    expect(clean(html)).toBe(html)
  })

  it('closes markup the rep has not finished typing, without losing the text', () => {
    // Autosave fires mid-sentence, so a half-written body is the normal case,
    // not an edge case.
    expect(clean('<p>unclosed <strong>bold')).toBe('<p>unclosed <strong>bold</strong></p>')
  })
})

describe('script injection', () => {
  it('drops a <script> tag AND its contents', () => {
    const out = clean('<p>Hi</p><script>alert(1)</script>')
    expect(out).toBe('<p>Hi</p>')
    expect(out).not.toContain('alert')
  })

  it('drops <script> written in mixed case', () => {
    // The parser lower-cases tag names before the allow-list is consulted, which
    // is why case games do not reach it.
    expect(clean('<ScRiPt>alert(1)</ScRiPt>')).toBe('')
    expect(clean('<SCRIPT SRC="//evil.example/x.js"></SCRIPT>')).toBe('')
  })

  it('does not reassemble a nested <scr<script>ipt> into a live tag', () => {
    // The classic bypass against a sanitiser that strips "<script>" once by
    // string replacement: removing the inner tag welds the outer one together.
    const out = clean('<scr<script>ipt>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<scr')
  })

  it('drops <script> nested inside <svg>', () => {
    expect(clean('<svg><script>alert(1)</script></svg>')).toBe('')
  })

  it('drops <style>, which can carry expressions and url(javascript:)', () => {
    expect(clean('<style>body{background:url(javascript:alert(1))}</style><p>after</p>')).toBe(
      '<p>after</p>',
    )
  })

  it('drops conditional comments, which are markup to a parser', () => {
    const out = clean('<!--[if IE]><script>alert(1)</script><![endif]--><p>x</p>')
    expect(out).toBe('<p>x</p>')
    expect(out).not.toContain('alert')
  })
})

describe('event handlers', () => {
  it.each([
    ['onerror', '<img src=x onerror="alert(1)">'],
    ['onload', '<body onload="alert(1)"><p>text</p></body>'],
    ['onclick', '<p onclick="alert(1)">text</p>'],
    ['onmouseover', '<p onmouseover=alert(1)>text</p>'],
    ['onfocus + autofocus', '<input autofocus onfocus="alert(1)">'],
    ['onanimationstart', '<p onanimationstart="alert(1)">text</p>'],
    ['mixed case OnClIcK', '<p OnClIcK="alert(1)">text</p>'],
    ['unquoted, on an allowed tag', '<a href="https://ok.example" onclick=alert(1)>ok</a>'],
  ])('strips %s', (_name, payload) => {
    const out = clean(payload)
    expect(out.toLowerCase()).not.toMatch(/\son[a-z]+\s*=/)
    expect(out).not.toContain('alert(1)')
  })

  it('keeps the link when only its handler was hostile', () => {
    // Deny by default is about attributes, not about punishing the whole element:
    // the rep's link is still a link.
    expect(clean('<a href="https://ok.example" onclick="alert(1)">ok</a>')).toBe(
      '<a href="https://ok.example">ok</a>',
    )
  })
})

describe('href schemes', () => {
  it.each([
    ['javascript:', '<a href="javascript:alert(1)">click</a>'],
    ['JaVaScRiPt: mixed case', '<a href="JaVaScRiPt:alert(1)">click</a>'],
    ['javascript: with an embedded tab', '<a href="java\tscript:alert(1)">click</a>'],
    ['javascript: with a leading space', '<a href="  javascript:alert(1)">click</a>'],
    ['decimal-entity-encoded javascript:', '<a href="&#106;avascript:alert(1)">click</a>'],
    ['hex-entity-encoded javascript:', '<a href="&#x6a;avascript&#58;alert(1)">click</a>'],
    ['vbscript:', '<a href="vbscript:msgbox(1)">click</a>'],
    [
      'data:text/html',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
    ],
    ['data:image/svg+xml', '<a href="data:image/svg+xml,<svg onload=alert(1)>">click</a>'],
    ['protocol-relative //', '<a href="//evil.example/x">click</a>'],
  ])('drops the href for %s and leaves an inert anchor', (_name, payload) => {
    const out = clean(payload)
    expect(out).not.toContain('href')
    expect(out.toLowerCase()).not.toContain('javascript')
    expect(out.toLowerCase()).not.toContain('vbscript')
    expect(out.toLowerCase()).not.toContain('data:')
    expect(out).toContain('click')
  })
})

describe('attributes other than href, target and rel', () => {
  it('keeps the <p> and loses the style — the case the spec names', () => {
    expect(clean('<p style="color:red;background:url(javascript:alert(1))">styled</p>')).toBe(
      '<p>styled</p>',
    )
  })

  it('strips class, id and data-* from an allowed tag', () => {
    expect(clean('<p class="evil" id="x" data-payload="1">c</p>')).toBe('<p>c</p>')
  })

  it('strips attributes that are not on the list even on <a>', () => {
    expect(clean('<a href="https://ok.example" srcdoc="x" download="y" ping="z">d</a>')).toBe(
      '<a href="https://ok.example">d</a>',
    )
  })

  it('forces rel="noopener noreferrer" on a link that opens a new tab', () => {
    // Without it the opened page gets a live `window.opener` back into ours.
    expect(clean('<a href="https://ok.example" target="_blank">ok</a>')).toBe(
      '<a href="https://ok.example" target="_blank" rel="noopener noreferrer">ok</a>',
    )
  })

  it('overwrites a rel the caller supplied, rather than trusting it', () => {
    expect(clean('<a href="https://ok.example" target="_blank" rel="opener">ok</a>')).toBe(
      '<a href="https://ok.example" target="_blank" rel="noopener noreferrer">ok</a>',
    )
  })
})

describe('tags that are not on the list', () => {
  it.each([
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['iframe with srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ['object', '<object data="x.swf"><param name="a"></object>'],
    ['embed', '<embed src="x.swf">'],
    ['svg with onload', '<svg onload="alert(1)"><circle r="1"/></svg>'],
    ['base', '<base href="https://evil.example/">'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
    ['textarea', '<textarea><p>x</p></textarea>'],
    ['template', '<template><script>alert(1)</script></template>'],
    ['math/mglyph mutation payload', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
    ['noscript title-attribute mutation payload', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ])('leaves nothing executable behind for %s', (_name, payload) => {
    const out = clean(payload)
    expect(out).not.toContain('alert(1)')
    expect(out).not.toContain('<')
    expect(out.toLowerCase()).not.toContain('javascript')
  })

  it('drops <animate>, so an SVG cannot rewrite an anchor into a javascript: link', () => {
    // The `<a>` is on the allow-list and survives as an inert, empty anchor. The
    // element that would have given it a live href does not.
    const out = clean('<svg><a><animate attributeName="href" to="javascript:alert(1)"/></a></svg>')
    expect(out).toBe('<a></a>')
    expect(out).not.toContain('animate')
    expect(out).not.toContain('href')
    expect(out.toLowerCase()).not.toContain('javascript')
  })

  it('unwraps a layout tag but keeps the rep’s words', () => {
    // Deny by default drops the TAG, not the sentence inside it. This is the one
    // fidelity cost worth knowing about: a paste that relied on <div> for its
    // line breaks arrives as a single run of text. The editor normalises to <p>
    // before it saves, so this is the shape a non-editor caller would send.
    expect(clean('<div>Hello</div><div>World</div>')).toBe('HelloWorld')
    expect(clean('<span style="font-weight:bold">span text</span>')).toBe('span text')
    expect(clean('<font color="red">font text</font>')).toBe('font text')
  })

  it('drops a form and its inputs, keeping only their text', () => {
    const out = clean('<form action="https://evil.example"><input name="password"><button>go</button></form>')
    expect(out).toBe('go')
  })
})

describe('idempotency', () => {
  // The route re-sanitises on every autosave, so "twice equals once" is a
  // correctness requirement, not a nicety. `clean()` asserts it on every payload
  // above; these pin the rule down on its own.
  it.each([
    '<p>Hi <strong>Ann</strong></p>',
    '<a href="https://ok.example" target="_blank">ok</a>',
    '<p>5 &lt; 6 &amp; 7</p>',
    '<p style="color:red">x</p><script>alert(1)</script>',
    '<ul><li><em>a</em></li></ul>',
  ])('sanitising twice changes nothing: %s', (html) => {
    const once = sanitizeRichTextHtml(html)
    expect(sanitizeRichTextHtml(once)).toBe(once)
    expect(sanitizeRichTextHtml(sanitizeRichTextHtml(once))).toBe(once)
  })
})

describe('sanitizeOptionalRichTextHtml', () => {
  it('passes null through, because "no body" is not "an empty body"', () => {
    expect(sanitizeOptionalRichTextHtml(null)).toBeNull()
    expect(sanitizeOptionalRichTextHtml(undefined)).toBeNull()
  })

  it('returns an empty string when every last tag was disallowed', () => {
    expect(sanitizeOptionalRichTextHtml('<script>alert(1)</script>')).toBe('')
  })

  it('sanitises a string the same way the non-nullable form does', () => {
    expect(sanitizeOptionalRichTextHtml('<p onclick="alert(1)">hi</p>')).toBe('<p>hi</p>')
  })
})
