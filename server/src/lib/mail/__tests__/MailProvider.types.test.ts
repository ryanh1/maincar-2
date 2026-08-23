// Type-level + unit tests for MailProvider.ts — THE SEAM (SPEC-int-seam.md § The seam).
//
// This file has no runtime behaviour to exercise: MailProvider.ts is types and one
// interface, no implementation. So these tests are mostly the COMPILER's job. The
// centrepiece is `stubProvider`, a value written with `satisfies MailProvider`: if
// a published signature is renamed, retyped, or dropped, this file stops compiling
// and `npm run typecheck` (the seam's own verification gate) goes red. A green
// typecheck here is the assertion that the contract still holds.
import { describe, expect, it } from 'vitest'
import type {
  CalendarEvent,
  InboundMessage,
  MailAddress,
  MailProvider,
  OutboundEmail,
  SentEmail,
} from '../MailProvider.js'

// A no-op assertion that two types are identical in both directions. Used below to
// pin exact return shapes — a widened or narrowed field fails to compile here.
type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

// A stub object that satisfies MailProvider. This is the acceptance criterion "a
// stub object satisfying MailProvider compiles" made executable: `satisfies` forces
// TypeScript to check every method's parameters and return type against the
// published interface, with no implementation and no provider SDK in sight.
const stubProvider = {
  provider: 'google',
  async sendEmail(input: OutboundEmail): Promise<SentEmail> {
    return { providerMsgId: 'm1', threadId: input.threadId ?? 't1', sentAt: new Date(0) }
  },
  async listMessagesSince(cursor: string | null, limit: number) {
    void cursor
    void limit
    return { messages: [] as InboundMessage[], nextCursor: null }
  },
  async getMessage(providerMsgId: string): Promise<InboundMessage> {
    return {
      providerMsgId,
      threadId: null,
      from: { email: 'a@example.com' },
      to: [],
      cc: [],
      subject: null,
      bodyHtml: null,
      bodyText: null,
      sentAt: new Date(0),
      isOutbound: false,
    }
  },
  async listBackfillMessages(cursor: string | null, limit: number, since: Date) {
    void cursor
    void limit
    void since
    return { messages: [] as InboundMessage[], nextCursor: null }
  },
  async listBackfillEvents(cursor: string | null, limit: number, since: Date) {
    void cursor
    void limit
    void since
    return { events: [] as CalendarEvent[], nextCursor: null }
  },
  async listEventsSince(cursor: string | null, limit: number) {
    void cursor
    void limit
    return { events: [] as CalendarEvent[], nextCursor: null }
  },
  async createEvent(input: Omit<CalendarEvent, 'providerEventId' | 'organizer'>): Promise<CalendarEvent> {
    return { ...input, providerEventId: 'e1', organizer: null }
  },
} satisfies MailProvider

describe('MailProvider — the published contract', () => {
  it('exposes a readonly provider discriminant of the published union', () => {
    // The union is exactly 'google' | 'microsoft' — nothing calls into a provider
    // SDK, this is only the discriminant a caller may branch on.
    const p: MailProvider['provider'] = stubProvider.provider
    expect(['google', 'microsoft']).toContain(p)
    type _ProviderUnion = Expect<MailProvider['provider'], 'google' | 'microsoft'>
    const _u: _ProviderUnion = true
    expect(_u).toBe(true)
  })

  it('declares all five published methods', () => {
    // A stub satisfying MailProvider necessarily carries all five; asserting they
    // are callable functions keeps the criterion honest at runtime too.
    for (const name of [
      'sendEmail',
      'listMessagesSince',
      'getMessage',
      'listBackfillMessages',
      'listBackfillEvents',
      'listEventsSince',
      'createEvent',
    ] as const) {
      expect(typeof stubProvider[name]).toBe('function')
    }
  })

  it('sendEmail returns the provider ids and a Date sentAt', async () => {
    const sent = await stubProvider.sendEmail({
      to: [{ email: 'b@example.com' }],
      subject: 'hi',
      bodyHtml: '<p>hi</p>',
    })
    // sentAt is a Date (the provider's timestamp at the seam) — never a string.
    type _SentAtIsDate = Expect<SentEmail['sentAt'], Date>
    const _d: _SentAtIsDate = true
    expect(_d).toBe(true)
    expect(sent.sentAt).toBeInstanceOf(Date)
    expect(sent.providerMsgId).toBe('m1')
  })

  it('paging methods are cursor-based, returning nextCursor and never an offset', async () => {
    const page = await stubProvider.listMessagesSince(null, 10)
    expect(page).toHaveProperty('nextCursor')
    expect(page).toHaveProperty('messages')
    const events = await stubProvider.listEventsSince(null, 10)
    expect(events).toHaveProperty('nextCursor')
    // The published return shapes carry nextCursor as `string | null`, not a number.
    type _MsgCursor = Expect<
      Awaited<ReturnType<MailProvider['listMessagesSince']>>,
      { messages: InboundMessage[]; nextCursor: string | null }
    >
    type _EvtCursor = Expect<
      Awaited<ReturnType<MailProvider['listEventsSince']>>,
      { events: CalendarEvent[]; nextCursor: string | null }
    >
    const _m: _MsgCursor = true
    const _e: _EvtCursor = true
    expect(_m && _e).toBe(true)
  })

  it('createEvent takes an event without provider-owned fields and returns them filled', async () => {
    const event = await stubProvider.createEvent({
      title: 'Sync',
      description: null,
      startsAt: new Date(0),
      endsAt: new Date(1000),
      isAllDay: false,
      attendees: [{ email: 'c@example.com' } satisfies MailAddress],
    })
    expect(event.providerEventId).toBe('e1')
    expect(event.organizer).toBeNull()
    // The input type omits exactly the two provider-owned fields.
    type _CreateInput = Expect<
      Parameters<MailProvider['createEvent']>[0],
      Omit<CalendarEvent, 'providerEventId' | 'organizer'>
    >
    const _c: _CreateInput = true
    expect(_c).toBe(true)
  })
})
