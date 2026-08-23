// microsoftMail.test.ts — runs the SHARED contract suite (mailProvider.contract.ts)
// against the real microsoftMail implementation, wired to a mocked Microsoft Graph
// transport. No test here reaches Microsoft (SPEC-int-seam.md § Testing strategy;
// IH-16 verification).
//
// HOW THE MOCK WORKS. The contract injects at the FACTORY: `makeProvider(scenario)`
// returns a `MailProvider` whose transport behaves as the scenario describes. Here
// that transport is a fake `GraphClient` built from the scenario and handed to
// `microsoftMail` in place of the real `graphClient(withFreshAccessToken(...))`. The
// fake is the ONLY thing faked — every line of microsoftMail (Graph message building,
// zod parsing, error mapping, delta-cursor logic, UTC mapping) runs for real against
// it.
//
// Because the fake stands in for Graph's HTTP, a forced failure is expressed the way
// Graph's SDK wrapper expresses it: a `ProviderApiError` carrying an HTTP status.
// microsoftMail maps that onto the seam's typed error, which is exactly what the
// contract asserts on. A test green here and red for Google (or vice versa) is the
// seam leaking.

import { describe, expect, it } from 'vitest'

import { ProviderApiError } from '../../../../dependencies/providerApiError.js'
import type { GraphClient } from '../../../../dependencies/graph.js'
import { microsoftMail } from '../microsoftMail.js'
import { CursorExpiredError } from '../mailErrors.js'
import type { CalendarEvent, InboundMessage, MailAddress } from '../MailProvider.js'
import { mailProviderContract, type MailProviderScenario } from './mailProvider.contract.js'

const MAILBOX = 'rep@example.com'
const PAGE = 10

// Graph hands back opaque, absolute URLs as delta/next cursors. The fake mints
// recognisable ones so a replay can be decoded back to an offset.
const NEXT_LINK = (offset: number): string =>
  `https://graph.example/me/mailFolders/inbox/messages/delta?$skiptoken=OFFSET-${offset}`
const MESSAGES_DELTA_DONE = 'https://graph.example/me/mailFolders/inbox/messages/delta?$deltatoken=DONE'
const EVENTS_DELTA_DONE = 'https://graph.example/me/calendarView/delta?$deltatoken=DONE'

// --- Small helpers ----------------------------------------------------------

/** Order messages oldest-first — Graph's delta is mocked to page in this order. */
function oldestFirst(messages: InboundMessage[]): InboundMessage[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
}

function graphAddr(a: MailAddress): { emailAddress: { address: string; name?: string } } {
  return { emailAddress: a.name ? { address: a.email, name: a.name } : { address: a.email } }
}

/** Build a Graph message resource from an `InboundMessage` fixture. */
function toGraphMessage(m: InboundMessage): Record<string, unknown> {
  return {
    id: m.providerMsgId,
    conversationId: m.threadId ?? undefined,
    subject: m.subject ?? undefined,
    from: graphAddr(m.from),
    toRecipients: m.to.map(graphAddr),
    ccRecipients: m.cc.map(graphAddr),
    body: { contentType: 'html', content: m.bodyHtml ?? '' },
    // Mail datetimes carry `Z` — an absolute UTC instant, unlike calendar times.
    sentDateTime: m.sentAt.toISOString(),
    receivedDateTime: m.sentAt.toISOString(),
  }
}

/**
 * Build a Graph event resource from a `CalendarEvent` fixture. The `dateTime` is
 * emitted WITHOUT a `Z` and paired with a separate `timeZone` — Graph's real shape —
 * so microsoftMail's wall-clock-to-UTC conversion is genuinely exercised, not bypassed.
 */
function toGraphEvent(e: CalendarEvent): Record<string, unknown> {
  return {
    id: e.providerEventId,
    subject: e.title ?? undefined,
    body: e.description != null ? { contentType: 'html', content: e.description } : undefined,
    start: { dateTime: e.startsAt.toISOString().slice(0, -1), timeZone: 'UTC' },
    end: { dateTime: e.endsAt.toISOString().slice(0, -1), timeZone: 'UTC' },
    isAllDay: e.isAllDay,
    attendees: e.attendees.map((a) => graphAddr(a)),
    organizer: e.organizer ? graphAddr(e.organizer) : undefined,
  }
}

function addressesOf(list: unknown): string[] {
  return ((list as { emailAddress?: { address?: string } }[] | undefined) ?? []).map(
    (r) => r.emailAddress?.address ?? '',
  )
}

/**
 * A fake `GraphClient` backed by one scenario. It mimics Graph's wire behaviour
 * closely enough that every real code path in microsoftMail is exercised: delta
 * paging with `@odata.nextLink` / `@odata.deltaLink`, a 410 Gone on an expired delta
 * token, HTTP-status failures via `ProviderApiError`, and a malformed body that must
 * fail a zod parse.
 */
function makeFakeClient(scenario: MailProviderScenario): GraphClient {
  const messages = scenario.messages ?? []

  const countAttempt = (): void => {
    if (scenario.attempts) scenario.attempts.count += 1
  }

  /** Auth and rate-limit failures arrive as a provider HTTP status, like the SDK. */
  const maybeThrowHttp = (): void => {
    if (scenario.failure === 'auth') throw new ProviderApiError('microsoft', { status: 401 })
    if (scenario.failure === 'rate-limited') {
      throw new ProviderApiError('microsoft', {
        status: 429,
        retryAfterMs: scenario.retryAfterMs ?? 0,
      })
    }
  }

  const offsetOf = (deltaLink: string): number => {
    const m = deltaLink.match(/OFFSET-(\d+)/)
    if (m) return Number(m[1])
    // A replayed "caught up" deltaLink points past the end: nothing new.
    return messages.length
  }

  return {
    provider: 'microsoft',

    async listMessages(opts = {}) {
      countAttempt()
      maybeThrowHttp()
      // An invalidated delta token is a 410 Gone from Graph — the seam's CursorExpiredError.
      if (scenario.expiredCursor != null && opts.deltaLink === scenario.expiredCursor) {
        throw new ProviderApiError('microsoft', { status: 410 })
      }
      const sorted = oldestFirst(messages)
      const offset = opts.deltaLink ? offsetOf(opts.deltaLink) : 0
      const slice = sorted.slice(offset, offset + PAGE)
      const nextOffset = offset + PAGE
      const hasMore = nextOffset < sorted.length
      return {
        value: slice.map(toGraphMessage),
        ...(hasMore ? { '@odata.nextLink': NEXT_LINK(nextOffset) } : { '@odata.deltaLink': MESSAGES_DELTA_DONE }),
      }
    },

    async getMessage(id) {
      countAttempt()
      maybeThrowHttp()
      // A malformed body must surface as MailApiError, never a TypeError: an empty
      // resource has no `id`, so microsoftMail's zod parse rejects it.
      if (scenario.failure === 'malformed') return {}
      const found = messages.find((m) => m.providerMsgId === id)
      return found ? toGraphMessage(found) : {}
    },

    async sendMail(message, _saveToSentItems = true) {
      countAttempt()
      maybeThrowHttp()
      // Flatten Graph's posted JSON into the neutral envelope-vs-visible views the
      // contract asserts on. bcc is delivered from the envelope (bccRecipients) but is
      // never written into a header a To/Cc recipient can read.
      const msg = message as {
        subject?: string
        toRecipients?: unknown
        ccRecipients?: unknown
        bccRecipients?: unknown
      }
      if (scenario.send) {
        scenario.send.envelopeRecipients = [
          ...addressesOf(msg.toRecipients),
          ...addressesOf(msg.ccRecipients),
          ...addressesOf(msg.bccRecipients),
        ]
        scenario.send.visibleHeaders = JSON.stringify({
          subject: msg.subject ?? '',
          to: addressesOf(msg.toRecipients),
          cc: addressesOf(msg.ccRecipients),
        })
      }
      const receipt = scenario.sendReceipt
      // This fixture exercises the optional receipt branch. Production Graph
      // `sendMail` returns a body-less 202, covered by the regression test below.
      return {
        id: receipt?.providerMsgId ?? 'sent-msg',
        conversationId: receipt?.threadId ?? 'sent-thread',
        sentDateTime: (receipt?.sentAt ?? new Date(0)).toISOString(),
      }
    },

    async listEvents(opts = {}) {
      countAttempt()
      maybeThrowHttp()
      if (scenario.expiredCursor != null && opts.deltaLink === scenario.expiredCursor) {
        throw new ProviderApiError('microsoft', { status: 410 })
      }
      return {
        value: (scenario.events ?? []).map(toGraphEvent),
        '@odata.deltaLink': EVENTS_DELTA_DONE,
      }
    },

    async createEvent(event) {
      countAttempt()
      maybeThrowHttp()
      // Echo the request back as a stored event, adding the id and organizer the
      // provider owns — exactly what a real insert returns.
      const e = event as Record<string, unknown>
      return {
        id: 'evt-created',
        subject: e.subject,
        body: e.body,
        start: e.start,
        end: e.end,
        isAllDay: e.isAllDay,
        attendees: e.attendees,
        organizer: { emailAddress: { address: 'organizer@example.com' } },
      }
    },
  }
}

/** The factory the contract drives: a scenario in, microsoftMail on mocked HTTP out. */
function makeProvider(scenario: MailProviderScenario) {
  const client = makeFakeClient(scenario)
  return microsoftMail({ connectionId: 'conn-1', emailAddress: MAILBOX }, async () => client)
}

// The shared suite, run against microsoftMail. A test green here and red for Google
// (or vice versa) is the seam leaking.
mailProviderContract('microsoft', makeProvider)

// --- Per-implementation tests (SPEC-int-seam.md § Testing strategy) ---------

describe('microsoftMail — Graph specifics', () => {
  it('accepts Graph’s body-less sendMail response without inventing a receipt', async () => {
    const client: GraphClient = {
      ...makeFakeClient({}),
      async sendMail() {
        return null
      },
    }
    const provider = microsoftMail({ connectionId: 'conn-1', emailAddress: MAILBOX }, async () => client)

    await expect(
      provider.sendEmail({
        to: [{ email: 'to@example.com' }],
        subject: 'Accepted by Graph',
        bodyHtml: '<p>Hi</p>',
      }),
    ).resolves.toEqual({ kind: 'accepted' })
  })

  it("sendEmail posts a Graph message with bcc in bccRecipients and HTML body, never a visible bcc header", async () => {
    let captured: Record<string, unknown> = {}
    const client: GraphClient = {
      ...makeFakeClient({}),
      async sendMail(message) {
        captured = message as Record<string, unknown>
        return { id: 'PMSG', conversationId: 'THREAD', sentDateTime: '2021-01-01T00:00:00.000Z' }
      },
    }
    const provider = microsoftMail({ connectionId: 'conn-1', emailAddress: MAILBOX }, async () => client)

    await provider.sendEmail({
      to: [{ email: 'to@example.com' }],
      cc: [{ name: 'Cee Cee', email: 'cc@example.com' }],
      bcc: [{ email: 'secret-bcc@example.com' }],
      subject: 'Quarterly review',
      bodyHtml: '<p>Hello &amp; welcome</p>',
    })

    expect(captured.subject).toBe('Quarterly review')
    expect(captured.body).toEqual({ contentType: 'HTML', content: '<p>Hello &amp; welcome</p>' })
    expect(addressesOf(captured.toRecipients)).toEqual(['to@example.com'])
    expect(addressesOf(captured.ccRecipients)).toEqual(['cc@example.com'])
    // bcc rides the envelope via bccRecipients — the blind copy is still delivered.
    expect(addressesOf(captured.bccRecipients)).toEqual(['secret-bcc@example.com'])
    // ...but it is not serialised into any To/Cc header a recipient could read.
    const visible = JSON.stringify({ subject: captured.subject, to: captured.toRecipients, cc: captured.ccRecipients })
    expect(visible).not.toContain('secret-bcc@example.com')
  })

  it("a Graph @odata.deltaLink round-trips as the cursor and replays through the message delta", async () => {
    const seeded: InboundMessage[] = [
      {
        providerMsgId: 'only-1',
        threadId: 'thread-only-1',
        from: { email: 'sender@example.com' },
        to: [{ email: MAILBOX }],
        cc: [],
        subject: 'one',
        bodyHtml: null,
        bodyText: null,
        sentAt: new Date('2021-02-02T00:00:00.000Z'),
        isOutbound: false,
      },
    ]
    const provider = makeProvider({ messages: seeded })

    // One message, no next page → the cursor carries the folder's deltaLink.
    const first = await provider.listMessagesSince(null, 10)
    expect(first.messages).toHaveLength(1)
    expect(first.nextCursor).toBeTruthy()

    // Replaying that deltaLink returns an empty page (nothing changed) and does NOT
    // throw — the delta path is wired end to end.
    const second = await provider.listMessagesSince(first.nextCursor, 10)
    expect(second.messages).toEqual([])
    expect(second.nextCursor).toBeTruthy()
  })

  it('starts and checkpoints a distinct delta stream for every Graph mail folder', async () => {
    const calls: Array<{ deltaLink?: string; folderId?: string }> = []
    const client: GraphClient = {
      ...makeFakeClient({}),
      async listMailFolders() {
        return { value: [{ id: 'inbox' }, { id: 'sentitems' }] }
      },
      async listMessages(opts = {}) {
        calls.push(opts)
        return {
          value: [],
          '@odata.deltaLink': `https://graph.example/me/mailFolders/${opts.folderId}/messages/delta?$deltatoken=done`,
        }
      },
    }
    const provider = microsoftMail({ connectionId: 'conn-1', emailAddress: MAILBOX }, async () => client)

    const page = await provider.listMessagesSince(null, 10)

    expect(calls).toEqual([{ folderId: 'inbox' }, { folderId: 'sentitems' }])
    const folders = JSON.parse(page.nextCursor!).folders
    expect(folders).toEqual({
      inbox: expect.stringContaining('/inbox/messages/delta'),
      sentitems: expect.stringContaining('/sentitems/messages/delta'),
    })
  })

  it('an invalidated Graph delta token throws CursorExpiredError', async () => {
    const stale = 'https://graph.example/me/mailFolders/inbox/messages/delta?$deltatoken=STALE'
    const provider = makeProvider({ expiredCursor: stale })
    await expect(provider.listMessagesSince(stale, 10)).rejects.toBeInstanceOf(CursorExpiredError)
  })

  it('getMessage reads the HTML body and flags the mailbox\'s own mail as outbound', async () => {
    const seeded: InboundMessage[] = [
      {
        providerMsgId: 'msg-body',
        threadId: 'thread-body',
        // Sent BY the mailbox itself → Graph has no SENT label, so outbound is
        // inferred from the sender being the mailbox.
        from: { name: 'Rep', email: MAILBOX },
        to: [{ email: 'client@example.com' }],
        cc: [],
        subject: 'Re: proposal',
        bodyHtml: '<p>the body</p>',
        bodyText: null,
        sentAt: new Date('2021-05-05T05:05:00.000Z'),
        isOutbound: true,
      },
    ]
    const provider = makeProvider({ messages: seeded })

    const msg = await provider.getMessage('msg-body')
    expect(msg.bodyHtml).toBe('<p>the body</p>')
    expect(msg.isOutbound).toBe(true)
    expect(msg.from).toEqual({ name: 'Rep', email: MAILBOX })
    expect(msg.sentAt.getTime()).toBe(new Date('2021-05-05T05:05:00.000Z').getTime())
  })

  it('an event wall-clock dateTime in a non-UTC timeZone converts to the right UTC instant', async () => {
    // Graph returns a naive wall-clock string plus a separate zone. Reading it as
    // server-local would land on the wrong instant; the pair must resolve to
    // 2021-03-01T14:00:00Z (09:00 New York, EST = UTC-5).
    const client: GraphClient = {
      ...makeFakeClient({}),
      async listEvents() {
        return {
          value: [
            {
              id: 'evt-tz',
              subject: 'Zoned',
              start: { dateTime: '2021-03-01T09:00:00.0000000', timeZone: 'America/New_York' },
              end: { dateTime: '2021-03-01T10:00:00.0000000', timeZone: 'America/New_York' },
              isAllDay: false,
              attendees: [],
            },
          ],
          '@odata.deltaLink': EVENTS_DELTA_DONE,
        }
      },
    }
    const provider = microsoftMail({ connectionId: 'conn-1', emailAddress: MAILBOX }, async () => client)

    const { events } = await provider.listEventsSince(null, 10)
    expect(events[0].startsAt.toISOString()).toBe('2021-03-01T14:00:00.000Z')
    expect(events[0].endsAt.toISOString()).toBe('2021-03-01T15:00:00.000Z')
  })

  it('createEvent sends UTC dateTimes with no offset and a UTC timeZone field', async () => {
    let captured: Record<string, unknown> = {}
    const client: GraphClient = {
      ...makeFakeClient({}),
      async createEvent(event) {
        captured = event as Record<string, unknown>
        return {
          id: 'evt-created',
          subject: captured.subject,
          start: captured.start,
          end: captured.end,
          isAllDay: captured.isAllDay,
          attendees: captured.attendees,
          organizer: { emailAddress: { address: 'organizer@example.com' } },
        }
      },
    }
    const provider = microsoftMail({ connectionId: 'conn-1', emailAddress: MAILBOX }, async () => client)

    await provider.createEvent({
      title: 'Kickoff',
      description: 'first call',
      startsAt: new Date('2021-03-01T09:00:00.000Z'),
      endsAt: new Date('2021-03-01T10:00:00.000Z'),
      isAllDay: false,
      attendees: [{ email: 'a@example.com' }],
    })

    // Graph's dateTimeTimeZone: the offset lives in `timeZone`, so `dateTime` carries none.
    expect(captured.start).toEqual({ dateTime: '2021-03-01T09:00:00.000', timeZone: 'UTC' })
    expect(captured.end).toEqual({ dateTime: '2021-03-01T10:00:00.000', timeZone: 'UTC' })
  })
})
