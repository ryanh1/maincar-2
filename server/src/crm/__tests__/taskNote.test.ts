// Unit tests for the Task/Note helpers (MAI-141 T13, spec §6, impacts §J).
//
// These cover the pure decisions: which strings the two models accept, how a
// TipTap document becomes the text stored beside it, which single company/person/
// deal a note's many links contribute to its feed row, and what the mappers do and
// do not put on the wire. The claims only a real database can prove — that a task
// links to a person/company/deal, that a note links to MANY records through the
// EXISTING RecordLink table, and that a calendar-derived task stays
// distinguishable — live in ../../routes/__tests__/tasks.integration.test.ts and
// notes.integration.test.ts.
import { describe, expect, it } from 'vitest'

import {
  BODY_TEXT_MAX_LENGTH,
  SPINE_LINK_OBJECTS,
  TASK_COMMITMENTS,
  TASK_ORIGINS,
  TASK_PRIORITIES,
  TASK_TYPES,
  flattenTipTapText,
  isSpineLinkObject,
  isTaskCommitment,
  isTaskOrigin,
  isTaskPriority,
  isTaskType,
  mapLinksToApi,
  mapNoteToApi,
  mapTaskToApi,
  rollUpSpineLinks,
} from '../taskNote.js'
import { dedupeLinkTargets, MAX_LINKS_PER_WORK_ITEM } from '../workLinks.js'
import type { Note, Task } from '../../generated/prisma/client.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')
const DUE = new Date('2026-08-25T16:00:00.000Z')

function taskRow(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    orgId: 'org-a',
    title: 'Call Jane back',
    body: null,
    type: 'call',
    priority: 'high',
    commitment: 'soft',
    assigneeUserId: 'user-a',
    dueAt: DUE,
    remindAt: null,
    eventId: null,
    origin: 'manual',
    isDone: false,
    doneAt: null,
    deletedAt: null,
    deletedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function noteRow(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    orgId: 'org-a',
    bodyJson: { type: 'doc', content: [] },
    bodyText: 'They want pricing by Friday.',
    authorUserId: 'user-a',
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// ============================================================
// The string unions — the type-safe half of the String columns
// ============================================================
describe('the Task string unions', () => {
  it('holds exactly the values the schema comments promise', () => {
    expect([...TASK_TYPES]).toEqual(['call', 'email', 'todo'])
    expect([...TASK_PRIORITIES]).toEqual(['low', 'med', 'high'])
    expect([...TASK_COMMITMENTS]).toEqual(['hard', 'soft'])
    expect([...TASK_ORIGINS]).toEqual(['manual', 'calendar'])
    expect([...SPINE_LINK_OBJECTS]).toEqual(['person', 'company', 'deal'])
  })

  it('narrows a known string and rejects everything else', () => {
    expect(isTaskType('call')).toBe(true)
    expect(isTaskType('sms')).toBe(false)
    expect(isTaskPriority('med')).toBe(true)
    expect(isTaskPriority('medium')).toBe(false)
    expect(isTaskCommitment('hard')).toBe(true)
    expect(isTaskCommitment('firm')).toBe(false)
    expect(isTaskOrigin('calendar')).toBe(true)
    expect(isTaskOrigin('google')).toBe(false)
    expect(isSpineLinkObject('deal')).toBe(true)
    expect(isSpineLinkObject('note')).toBe(false)
  })

  it('rejects a non-string without throwing', () => {
    for (const guard of [isTaskType, isTaskPriority, isTaskCommitment, isTaskOrigin]) {
      expect(guard(undefined)).toBe(false)
      expect(guard(null)).toBe(false)
      expect(guard(3)).toBe(false)
      expect(guard({})).toBe(false)
    }
  })
})

// ============================================================
// flattenTipTapText — the ONE place bodyJson becomes bodyText
// ============================================================
describe('flattenTipTapText', () => {
  it('pulls the text out of a paragraph document', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'They want pricing by Friday.' }] },
      ],
    }
    expect(flattenTipTapText(doc)).toBe('They want pricing by Friday.')
  })

  it('keeps blocks on separate lines so words never fuse across them', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next steps' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Send the deck' }] },
      ],
    }
    // Not "Next stepsSend the deck", which would match neither search.
    expect(flattenTipTapText(doc)).toBe('Next steps\nSend the deck')
  })

  it('joins marked runs inside one paragraph without inventing a space', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Budget is ' },
            { type: 'text', marks: [{ type: 'bold' }], text: '£40k' },
            { type: 'text', text: ' this year.' },
          ],
        },
      ],
    }
    expect(flattenTipTapText(doc)).toBe('Budget is £40k this year.')
  })

  it('treats a hard break as a line break', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'One' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Two' },
          ],
        },
      ],
    }
    expect(flattenTipTapText(doc)).toBe('One\nTwo')
  })

  it('walks a list, and an unknown node type, for the text inside', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ],
        },
        // A node type this server has never heard of still contributes its text —
        // the editor gains node types and the server must not lose notes over it.
        { type: 'callout2000', content: [{ type: 'text', text: 'Later' }] },
      ],
    }
    expect(flattenTipTapText(doc)).toBe('A\nB\nLater')
  })

  it('collapses runs of whitespace and blank lines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '  spaced    out  ' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'after a gap' }] },
      ],
    }
    expect(flattenTipTapText(doc)).toBe('spaced out\nafter a gap')
  })

  it('returns "" for an empty, missing, or unrecognisable document rather than throwing', () => {
    // A note whose body is only a picture is a real note and must still save.
    expect(flattenTipTapText({ type: 'doc', content: [] })).toBe('')
    expect(flattenTipTapText({})).toBe('')
    expect(flattenTipTapText(null)).toBe('')
    expect(flattenTipTapText(undefined)).toBe('')
    expect(flattenTipTapText('not a document')).toBe('')
    expect(flattenTipTapText(42)).toBe('')
  })

  it('caps the stored text, leaving bodyJson to hold the whole document', () => {
    const long = 'x'.repeat(BODY_TEXT_MAX_LENGTH + 500)
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: long }] }] }
    expect(flattenTipTapText(doc)).toHaveLength(BODY_TEXT_MAX_LENGTH)
  })
})

// ============================================================
// rollUpSpineLinks — many links, one feed row
// ============================================================
describe('rollUpSpineLinks', () => {
  it('picks the first of each spine object out of many links', () => {
    const rolled = rollUpSpineLinks([
      { object: 'company', id: 'co-1' },
      { object: 'person', id: 'person-1' },
      { object: 'person', id: 'person-2' },
      { object: 'deal', id: 'deal-1' },
      { object: 'project', id: 'rec-9' },
    ])
    expect(rolled).toEqual({ personId: 'person-1', companyId: 'co-1', dealId: 'deal-1' })
  })

  it('returns nulls when a note is attached only to custom records', () => {
    expect(rollUpSpineLinks([{ object: 'project', id: 'rec-9' }])).toEqual({
      personId: null,
      companyId: null,
      dealId: null,
    })
  })

  it('returns nulls for a note attached to nothing', () => {
    expect(rollUpSpineLinks([])).toEqual({ personId: null, companyId: null, dealId: null })
  })
})

// ============================================================
// dedupeLinkTargets — the same record named twice is one attachment
// ============================================================
describe('dedupeLinkTargets', () => {
  it('collapses a repeated target, preserving order', () => {
    expect(
      dedupeLinkTargets([
        { object: 'company', id: 'co-1' },
        { object: 'person', id: 'p-1' },
        { object: 'company', id: 'co-1' },
      ]),
    ).toEqual([
      { object: 'company', id: 'co-1' },
      { object: 'person', id: 'p-1' },
    ])
  })

  it('keeps the same id under two different objects — they are two records', () => {
    const targets = [
      { object: 'company', id: 'shared-id' },
      { object: 'person', id: 'shared-id' },
    ]
    expect(dedupeLinkTargets(targets)).toEqual(targets)
  })

  it('caps attachments at a number far past any real note', () => {
    expect(MAX_LINKS_PER_WORK_ITEM).toBeGreaterThanOrEqual(10)
  })
})

// ============================================================
// The mappers
// ============================================================
describe('mapTaskToApi', () => {
  it('never puts the tenant boundary or the trash columns on the wire', () => {
    const shaped = mapTaskToApi(taskRow({ deletedAt: NOW, deletedById: 'user-b' }))
    expect(shaped).not.toHaveProperty('orgId')
    expect(shaped).not.toHaveProperty('deletedAt')
    expect(shaped).not.toHaveProperty('deletedById')
  })

  it('returns origin and eventId as two separate facts', () => {
    // A hand-made task linked to a meeting: it HAS an event and is still manual.
    // Collapsing these two into one "from the calendar?" flag is what would let a
    // sync delete work somebody committed to by hand.
    const shaped = mapTaskToApi(taskRow({ eventId: 'evt-1', origin: 'manual' }))
    expect(shaped.eventId).toBe('evt-1')
    expect(shaped.origin).toBe('manual')

    const derived = mapTaskToApi(taskRow({ eventId: 'evt-1', origin: 'calendar' }))
    expect(derived.origin).toBe('calendar')
  })

  it('renders dates as ISO instants and nulls as null', () => {
    const shaped = mapTaskToApi(taskRow())
    expect(shaped.dueAt).toBe(DUE.toISOString())
    expect(shaped.remindAt).toBeNull()
    expect(shaped.doneAt).toBeNull()
    expect(shaped.createdAt).toBe(NOW.toISOString())
  })

  it('includes links only when the caller loaded them', () => {
    expect(mapTaskToApi(taskRow())).not.toHaveProperty('links')
    const withLinks = mapTaskToApi(
      Object.assign(taskRow(), { links: [{ toObject: 'person', toId: 'p-1' }] }),
    )
    expect(withLinks.links).toEqual([{ object: 'person', id: 'p-1' }])
  })
})

describe('mapNoteToApi', () => {
  it('sends BOTH bodies — the document to edit and the text to render', () => {
    const shaped = mapNoteToApi(noteRow())
    expect(shaped.bodyJson).toEqual({ type: 'doc', content: [] })
    expect(shaped.bodyText).toBe('They want pricing by Friday.')
  })

  it('never puts the tenant boundary or the trash column on the wire', () => {
    const shaped = mapNoteToApi(noteRow({ deletedAt: NOW }))
    expect(shaped).not.toHaveProperty('orgId')
    expect(shaped).not.toHaveProperty('deletedAt')
  })
})

describe('mapLinksToApi', () => {
  it('renames the directional storage columns to the note-side view', () => {
    expect(
      mapLinksToApi([
        { toObject: 'company', toId: 'co-1' },
        { toObject: 'deal', toId: 'deal-1' },
      ]),
    ).toEqual([
      { object: 'company', id: 'co-1' },
      { object: 'deal', id: 'deal-1' },
    ])
  })
})
