import { describe, expect, it } from 'vitest'

import {
  buildMentionEvent,
  mentionEventKey,
  sanitizeTipTapDocument,
  type RichTextMentionSource,
} from '../richTextMentions.js'

const source: RichTextMentionSource = {
  orgId: 'org-1',
  sourceType: 'note',
  sourceId: 'note-1',
  actorUserId: 'actor-1',
  title: 'You were mentioned in a note',
}

describe('sanitizeTipTapDocument', () => {
  it('preserves a teammate mention node identity through a round-trip', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Please review, ' },
            { type: 'mention', attrs: { id: 'user-1', label: 'Taylor Teammate', kind: 'teammate' } },
          ],
        },
      ],
    }

    expect(sanitizeTipTapDocument(document)).toEqual(document)
  })

  it('preserves a linked-record mention node identity (contact/company/deal)', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'co-1', label: 'Acme', kind: 'company' } },
            { type: 'mention', attrs: { id: 'contact-1', label: 'Ada', kind: 'contact' } },
            { type: 'mention', attrs: { id: 'deal-1', label: 'Big deal', kind: 'deal' } },
          ],
        },
      ],
    }

    expect(sanitizeTipTapDocument(document)).toEqual(document)
  })

  it('strips executable and presentation attributes from a mention without discarding its identity', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: {
                id: 'user-1',
                label: 'Taylor Teammate',
                kind: 'teammate',
                onclick: 'alert(1)',
                style: 'color: red',
                'data-forged': 'x',
              },
            },
          ],
        },
      ],
    }

    expect(sanitizeTipTapDocument(document)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'user-1', label: 'Taylor Teammate', kind: 'teammate' } },
          ],
        },
      ],
    })
  })

  it('drops a dangerous URL scheme on a link mark and an image src', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            { type: 'image', attrs: { src: 'data:text/html,<script>alert(1)</script>' } },
          ],
        },
      ],
    }

    expect(sanitizeTipTapDocument(document)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'click', marks: [{ type: 'link' }] },
            { type: 'image' },
          ],
        },
      ],
    })
  })

  it('keeps a safe href and src, and strips event handlers and style on any node', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)', style: 'color: red' },
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }],
            },
            { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'A' } },
          ],
        },
      ],
    }

    expect(sanitizeTipTapDocument(document)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }],
            },
            { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'A' } },
          ],
        },
      ],
    })
  })

  it('is idempotent — sanitizing a sanitized document returns it unchanged', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'user-1', label: 'Taylor', kind: 'teammate', onclick: 'x' } },
          ],
        },
      ],
    }

    const once = sanitizeTipTapDocument(document)
    expect(sanitizeTipTapDocument(once)).toEqual(once)
  })

  it('walks unknown node types rather than rejecting them, preserving their text', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'futureNode', attrs: { something: 'kept' }, content: [{ type: 'text', text: 'hi' }] },
      ],
    }

    expect(sanitizeTipTapDocument(document)).toEqual(document)
  })
})

describe('mention source contract', () => {
  it('derives a deterministic event key from the source type and record', () => {
    expect(mentionEventKey(source)).toBe('note:note-1:mentions:v1')
    expect(mentionEventKey({ sourceType: 'call_comment', sourceId: 'comment-1' })).toBe(
      'call_comment:comment-1:mentions:v1',
    )
  })

  it('builds a full notification event with a safe plain-text snapshot', () => {
    expect(
      buildMentionEvent(source, { bodyText: 'Can you take this?', recipientUserIds: ['user-2'] }),
    ).toEqual({
      orgId: 'org-1',
      eventKey: 'note:note-1:mentions:v1',
      actorUserId: 'actor-1',
      verb: 'mentioned',
      object: {
        type: 'note',
        id: 'note-1',
        sourceSnapshot: { title: 'You were mentioned in a note', preview: 'Can you take this?' },
      },
      recipientUserIds: ['user-2'],
    })
  })

  it('falls back to a safe preview when the flattened body is empty', () => {
    const event = buildMentionEvent(source, { bodyText: '', recipientUserIds: ['user-2'] })
    expect(event.object.sourceSnapshot.preview).toBe('A teammate mentioned you.')
  })
})
