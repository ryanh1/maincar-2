// mailProvider.contract.ts — THE SHARED CONTRACT SUITE (SPEC-int-seam.md § Testing
// strategy, MAI-104 / IH-14).
//
// One file of tests, written against the interface and run twice — once per
// implementation. It lands BEFORE either implementation (googleMail / IH-15,
// microsoftMail / IH-16), so it describes the SEAM rather than describing whichever
// provider happened to be built first. Each implementation's test file imports
// `mailProviderContract` and runs it against its own provider, wired to mocked HTTP:
//
//     import { mailProviderContract } from './mailProvider.contract.js'
//     mailProviderContract('google', (scenario) => makeGoogleProviderFrom(scenario))
//
// THE ONE RULE THIS FILE ENFORCES: a test here that passes for one provider and
// fails for the other is the seam leaking. The behaviour asserted below is the
// interface's behaviour; both providers bend to it, and it never bends to either.
//
// PROVIDER-NEUTRAL BY CONSTRUCTION. This file imports NO provider SDK and knows NO
// provider name — the only `name` it sees is the label an implementation passes in
// for its `describe` block. It never asserts a provider is 'google' or 'microsoft',
// only that the discriminant is one of the two the interface publishes.
//
// HOW ERROR CONDITIONS ARE INJECTED. A contract test needs to drive the provider
// into states a live mailbox reaches — a stale cursor, a 401, a 429, a malformed
// body — without leaking test hooks onto the production `MailProvider` interface.
// So the injection point is the FACTORY, not the interface: `makeProvider` takes a
// declarative `MailProviderScenario` and returns a provider whose mocked transport
// behaves accordingly. An implementation's adapter translates the scenario into
// that provider's HTTP mocks; the in-memory fake in `mailProvider.contract.test.ts`
// translates it directly. Both honour the SAME scenario, which is what makes the
// scenario an executable specification of the adapter each implementation must write.

import { describe, expect, it } from 'vitest'
import type { CalendarEvent, InboundMessage, MailProvider, SentEmail } from '../MailProvider.js'
import {
  CursorExpiredError,
  MailApiError,
  MailAuthError,
  RateLimitedError,
} from '../mailErrors.js'

/** How the mocked transport should fail the next provider read. */
export type ProviderFailure = 'auth' | 'rate-limited' | 'malformed'

/**
 * What a `sendEmail` actually wrote, normalized across providers. Gmail encodes an
 * RFC 822 message; Graph posts JSON — but both must deliver bcc via the ENVELOPE and
 * keep it out of any header a recipient can read. The adapter fills this in with its
 * provider's wire representation flattened to these two neutral views.
 */
export type SendCapture = {
  /** Every address the message is delivered to — to, cc AND bcc. */
  envelopeRecipients: string[]
  /** The header block a recipient can see. A bcc address must NEVER appear here. */
  visibleHeaders: string
}

/**
 * A declarative description of the mailbox/calendar state and failure mode the
 * provider's mocked transport should present for one test. Every field is optional;
 * a test sets only what it needs. The `send` and `attempts` fields are capture sinks
 * the provider writes back into, so a test can assert on what the provider did.
 */
export type MailProviderScenario = {
  /** Messages the mailbox holds. The provider returns them oldest-first, paged. */
  messages?: InboundMessage[]
  /** Events the calendar holds. */
  events?: CalendarEvent[]
  /** The receipt the provider reports for a send — its OWN ids and its OWN timestamp. */
  sendReceipt?: SentEmail
  /** Replaying this exact cursor throws `CursorExpiredError`. */
  expiredCursor?: string
  /** The next provider read fails this way. */
  failure?: ProviderFailure
  /** Milliseconds the provider asks the caller to wait, for a `'rate-limited'` failure. */
  retryAfterMs?: number
  /** Capture sink: `sendEmail` fills this with the normalized envelope vs. visible headers. */
  send?: SendCapture
  /** Capture sink: incremented once per underlying provider call, to prove no retry. */
  attempts?: { count: number }
}

/** The factory an implementation supplies: scenario in, a provider on mocked HTTP out. */
export type MakeProvider = (scenario: MailProviderScenario) => MailProvider | Promise<MailProvider>

/** Build an `InboundMessage` fixture at a known UTC instant. */
function inboundAt(providerMsgId: string, isoUtc: string): InboundMessage {
  return {
    providerMsgId,
    threadId: `thread-${providerMsgId}`,
    from: { email: 'sender@example.com' },
    to: [{ email: 'rep@example.com' }],
    cc: [],
    subject: `subject ${providerMsgId}`,
    bodyHtml: null,
    bodyText: null,
    sentAt: new Date(isoUtc),
    isOutbound: false,
  }
}

/**
 * The shared contract. Call it once per implementation with a label and a factory.
 * A test that is green here for one provider and red for another is the seam leaking.
 */
export function mailProviderContract(name: string, makeProvider: MakeProvider): void {
  describe(`MailProvider contract — ${name}`, () => {
    it('exposes a provider discriminant that is one of the published union members', async () => {
      const provider = await makeProvider({})
      expect(['google', 'microsoft']).toContain(provider.provider)
    })

    it("sendEmail returns the provider's ids and the provider's OWN timestamp", async () => {
      // A fixed instant well in the past. If an implementation computed `new Date()`
      // locally instead of reading the provider's response, the returned value would
      // be ~now and this would fail.
      const providerSentAt = new Date('2021-06-01T12:00:00.000Z')
      const provider = await makeProvider({
        sendReceipt: { providerMsgId: 'PMSG-1', threadId: 'THREAD-1', sentAt: providerSentAt },
      })

      const observedBefore = Date.now()
      const sent = await provider.sendEmail({
        to: [{ email: 'recipient@example.com' }],
        subject: 'hello',
        bodyHtml: '<p>hello</p>',
      })

      expect('kind' in sent).toBe(false)
      if ('kind' in sent) throw new Error(`${name} did not return the fixture's send receipt.`)
      expect(sent.providerMsgId).toBe('PMSG-1')
      expect(sent.threadId).toBe('THREAD-1')
      expect(sent.sentAt).toBeInstanceOf(Date)
      expect(sent.sentAt.getTime()).toBe(providerSentAt.getTime())
      // It is the provider's timestamp, not one computed during this test run.
      expect(sent.sentAt.getTime()).toBeLessThan(observedBefore)
    })

    it('sendEmail puts bcc in the envelope and never in a visible header', async () => {
      const send: SendCapture = { envelopeRecipients: [], visibleHeaders: '' }
      const provider = await makeProvider({
        send,
        sendReceipt: { providerMsgId: 'PMSG-2', threadId: 'THREAD-2', sentAt: new Date(0) },
      })

      await provider.sendEmail({
        to: [{ email: 'to@example.com' }],
        cc: [{ email: 'cc@example.com' }],
        bcc: [{ email: 'secret-bcc@example.com' }],
        subject: 'quiet copy',
        bodyHtml: '<p>hi</p>',
      })

      // bcc is delivered — it is on the envelope.
      expect(send.envelopeRecipients).toContain('secret-bcc@example.com')
      // to and cc are on the envelope too.
      expect(send.envelopeRecipients).toEqual(
        expect.arrayContaining(['to@example.com', 'cc@example.com']),
      )
      // to and cc are visible to a recipient; bcc is not.
      expect(send.visibleHeaders).toContain('to@example.com')
      expect(send.visibleHeaders).toContain('cc@example.com')
      expect(send.visibleHeaders).not.toContain('secret-bcc@example.com')
    })

    it('listMessagesSince(null, 10) returns messages oldest-first with a cursor', async () => {
      // Seeded newest-first to prove the provider sorts, not the seed order.
      const seeded = Array.from({ length: 11 }, (_, i) => {
        const n = 11 - i // 11, 10, ... 1
        const iso = `2021-01-${String(n).padStart(2, '0')}T00:00:00.000Z`
        return inboundAt(`m${String(n).padStart(2, '0')}`, iso)
      })
      const provider = await makeProvider({ messages: seeded })

      const page = await provider.listMessagesSince(null, 10)

      expect(page.messages).toHaveLength(10)
      // Oldest first: m01, m02, ... m10.
      const times = page.messages.map((m) => m.sentAt.getTime())
      expect(times).toEqual([...times].sort((a, b) => a - b))
      expect(page.messages[0].providerMsgId).toBe('m01')
      // There is an 11th message, so the page carries a cursor rather than ending.
      expect(typeof page.nextCursor).toBe('string')
      expect(page.nextCursor).not.toBeNull()
    })

    it('replaying the returned cursor yields the NEXT page, not the same one', async () => {
      const seeded = Array.from({ length: 11 }, (_, i) => {
        const n = i + 1
        const iso = `2021-01-${String(n).padStart(2, '0')}T00:00:00.000Z`
        return inboundAt(`m${String(n).padStart(2, '0')}`, iso)
      })
      const provider = await makeProvider({ messages: seeded })

      const first = await provider.listMessagesSince(null, 10)
      expect(first.nextCursor).not.toBeNull()

      const second = await provider.listMessagesSince(first.nextCursor, 10)

      // The next page holds the 11th message — advanced, not restarted.
      const firstIds = first.messages.map((m) => m.providerMsgId)
      const secondIds = second.messages.map((m) => m.providerMsgId)
      expect(secondIds).not.toEqual(firstIds)
      expect(secondIds).toContain('m11')
      expect(firstIds).not.toContain('m11')
    })

    it('an expired cursor throws CursorExpiredError', async () => {
      const provider = await makeProvider({ expiredCursor: 'STALE-CURSOR' })
      await expect(provider.listMessagesSince('STALE-CURSOR', 10)).rejects.toBeInstanceOf(
        CursorExpiredError,
      )
    })

    it('a 401 after a fresh token throws MailAuthError and does not retry', async () => {
      const attempts = { count: 0 }
      const provider = await makeProvider({ failure: 'auth', attempts })

      await expect(provider.listMessagesSince(null, 10)).rejects.toBeInstanceOf(MailAuthError)
      // The token was already refreshed before the call; a 401 here is a real failure,
      // so the seam surfaces it once and never loops.
      expect(attempts.count).toBe(1)
    })

    it('a 429 throws RateLimitedError carrying retryAfterMs', async () => {
      const provider = await makeProvider({ failure: 'rate-limited', retryAfterMs: 4200 })

      const thrown = await provider.listMessagesSince(null, 10).then(
        () => null,
        (e: unknown) => e,
      )
      expect(thrown).toBeInstanceOf(RateLimitedError)
      expect((thrown as RateLimitedError).retryAfterMs).toBe(4200)
    })

    it('createEvent round-trips title, start, end, and attendees', async () => {
      const startsAt = new Date('2021-03-01T09:00:00.000Z')
      const endsAt = new Date('2021-03-01T10:00:00.000Z')
      const provider = await makeProvider({})

      const created = await provider.createEvent({
        title: 'Kickoff',
        description: 'first call',
        startsAt,
        endsAt,
        isAllDay: false,
        attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      })

      expect(created.title).toBe('Kickoff')
      expect(created.startsAt.getTime()).toBe(startsAt.getTime())
      expect(created.endsAt.getTime()).toBe(endsAt.getTime())
      expect(created.attendees.map((a) => a.email)).toEqual(['a@example.com', 'b@example.com'])
      // The provider owns the id, so it comes back filled.
      expect(created.providerEventId).toBeTruthy()
    })

    it('every Date crossing the seam is a valid UTC instant that round-trips exactly', async () => {
      const messageSentAt = new Date('2021-07-04T15:30:00.000Z')
      const eventStart = new Date('2021-07-04T16:00:00.000Z')
      const eventEnd = new Date('2021-07-04T17:00:00.000Z')

      const provider = await makeProvider({
        messages: [inboundAt('utc-1', messageSentAt.toISOString())],
        events: [
          {
            providerEventId: 'evt-1',
            title: 'UTC check',
            description: null,
            startsAt: eventStart,
            endsAt: eventEnd,
            isAllDay: false,
            attendees: [],
            organizer: null,
          },
        ],
      })

      const { messages } = await provider.listMessagesSince(null, 10)
      expect(messages[0].sentAt).toBeInstanceOf(Date)
      expect(Number.isNaN(messages[0].sentAt.getTime())).toBe(false)
      // A provider that mis-read a wall-clock time as server-local would land on a
      // different instant; an exact epoch match is the UTC guarantee.
      expect(messages[0].sentAt.getTime()).toBe(messageSentAt.getTime())

      const { events } = await provider.listEventsSince(null, 10)
      expect(events[0].startsAt.getTime()).toBe(eventStart.getTime())
      expect(events[0].endsAt.getTime()).toBe(eventEnd.getTime())
    })

    it('a malformed provider payload throws MailApiError and never a TypeError', async () => {
      const provider = await makeProvider({ failure: 'malformed' })

      const thrown = await provider.getMessage('any-id').then(
        () => null,
        (e: unknown) => e,
      )
      expect(thrown).toBeInstanceOf(MailApiError)
      // The whole point of parsing before trusting: a shape change surfaces as a
      // typed mail error, not as `undefined.length` three frames deep.
      expect(thrown).not.toBeInstanceOf(TypeError)
    })
  })
}
