// googleMail.test.ts — runs the SHARED contract suite (mailProvider.contract.ts)
// against the real googleMail implementation, wired to a mocked Gmail + Google
// Calendar transport. No test here reaches Google (SPEC-int-seam.md § Testing
// strategy; IH-15 verification).
//
// HOW THE MOCK WORKS. The contract injects at the FACTORY: `makeProvider(scenario)`
// returns a `MailProvider` whose transport behaves as the scenario describes. Here
// that transport is a fake `GmailClient` built from the scenario and handed to
// `googleMail` in place of the real `gmailClient(withFreshAccessToken(...))`. The
// fake is the ONLY thing faked — every line of googleMail (RFC 822 building, zod
// parsing, error mapping, cursor logic, UTC mapping) runs for real against it.
//
// Because the fake stands in for Gmail's HTTP, a forced failure is expressed the way
// Gmail's SDK wrapper expresses it: a `ProviderApiError` carrying an HTTP status.
// googleMail maps that onto the seam's typed error, which is exactly what the
// contract asserts on.

import { describe, expect, it } from 'vitest'

import type { calendar_v3, gmail_v1 } from 'googleapis'
import { ProviderApiError } from '../../../../dependencies/providerApiError.js'
import type { GmailClient } from '../../../../dependencies/gmail.js'
import { googleMail } from '../googleMail.js'
import { CursorExpiredError } from '../mailErrors.js'
import type { CalendarEvent, InboundMessage, MailAddress } from '../MailProvider.js'
import { mailProviderContract, type MailProviderScenario } from './mailProvider.contract.js'

// --- Small helpers shared with the fake -------------------------------------

/** Render an address the way an RFC 822 header carries it. */
function formatAddr(a: MailAddress): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

/** Order messages oldest-first — Gmail's list is mocked to page in this order. */
function oldestFirst(messages: InboundMessage[]): InboundMessage[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
}

/** Pull the bare email addresses out of a To/Cc/Bcc header value. */
function extractEmails(headerValue: string): string[] {
  return headerValue
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const angle = s.match(/<([^>]+)>/)
      return (angle ? angle[1] : s).trim()
    })
}

/** Build a Gmail message resource from an `InboundMessage` fixture. */
function toGmailMessage(m: InboundMessage): gmail_v1.Schema$Message {
  return {
    id: m.providerMsgId,
    threadId: m.threadId ?? undefined,
    labelIds: m.isOutbound ? ['SENT'] : ['INBOX'],
    internalDate: String(m.sentAt.getTime()),
    payload: {
      mimeType: 'text/html',
      headers: [
        { name: 'From', value: formatAddr(m.from) },
        { name: 'To', value: m.to.map(formatAddr).join(', ') },
        { name: 'Cc', value: m.cc.map(formatAddr).join(', ') },
        { name: 'Subject', value: m.subject ?? '' },
      ],
      body: { data: Buffer.from(m.bodyHtml ?? '', 'utf8').toString('base64url') },
    },
  }
}

/** Build a Google Calendar event resource from a `CalendarEvent` fixture. */
function toGoogleEvent(e: CalendarEvent): calendar_v3.Schema$Event {
  return {
    id: e.providerEventId,
    summary: e.title ?? undefined,
    description: e.description ?? undefined,
    start: { dateTime: e.startsAt.toISOString() },
    end: { dateTime: e.endsAt.toISOString() },
    attendees: e.attendees.map((a) => ({ email: a.email, displayName: a.name })),
    organizer: e.organizer ? { email: e.organizer.email, displayName: e.organizer.name } : undefined,
  }
}

/**
 * A fake `GmailClient` backed by one scenario. It mimics Gmail's wire behaviour
 * closely enough that every real code path in googleMail is exercised: paging over
 * `messages.list`, a 404 on an aged-out `history.list`, HTTP-status failures via
 * `ProviderApiError`, and a malformed body that must fail a zod parse.
 */
function makeFakeClient(scenario: MailProviderScenario): GmailClient {
  const messages = scenario.messages ?? []

  const countAttempt = (): void => {
    if (scenario.attempts) scenario.attempts.count += 1
  }

  /** Auth and rate-limit failures arrive as a provider HTTP status, like the SDK. */
  const maybeThrowHttp = (): void => {
    if (scenario.failure === 'auth') throw new ProviderApiError('google', { status: 401 })
    if (scenario.failure === 'rate-limited') {
      throw new ProviderApiError('google', { status: 429, retryAfterMs: scenario.retryAfterMs ?? 0 })
    }
  }

  return {
    provider: 'google',

    async getProfile() {
      countAttempt()
      maybeThrowHttp()
      return { emailAddress: 'rep@example.com', historyId: 'SEED-1' }
    },

    async listMessages(params = {}) {
      countAttempt()
      maybeThrowHttp()
      const sorted = oldestFirst(messages)
      const offset = params.pageToken ? Number(params.pageToken) : 0
      const max = params.maxResults ?? sorted.length
      const slice = sorted.slice(offset, offset + max)
      const nextPageToken = offset + max < sorted.length ? String(offset + max) : undefined
      return {
        messages: slice.map((m) => ({ id: m.providerMsgId, threadId: m.threadId ?? undefined })),
        nextPageToken,
        resultSizeEstimate: sorted.length,
      }
    },

    async listHistory(params) {
      countAttempt()
      maybeThrowHttp()
      // An aged-out startHistoryId is a 404 from Gmail — the seam's CursorExpiredError.
      if (scenario.expiredCursor != null && params.startHistoryId === scenario.expiredCursor) {
        throw new ProviderApiError('google', { status: 404 })
      }
      // A live delta with nothing new: an empty page that still advances the cursor.
      return { history: [], historyId: 'H-NEXT' }
    },

    async getMessage(id) {
      countAttempt()
      maybeThrowHttp()
      // A malformed body must surface as MailApiError, never a TypeError: an empty
      // resource has no `id`, so googleMail's zod parse rejects it.
      if (scenario.failure === 'malformed') return {}
      const found = messages.find((m) => m.providerMsgId === id)
      return found ? toGmailMessage(found) : {}
    },

    async sendMessage(raw, threadId) {
      countAttempt()
      maybeThrowHttp()
      // Flatten Gmail's wire form (a base64url RFC 822 message) into the neutral
      // envelope-vs-visible views the contract asserts on. Gmail delivers to a Bcc
      // header then strips it, so it counts toward the envelope but never the
      // headers a recipient can read.
      const decoded = Buffer.from(raw, 'base64url').toString('utf8')
      const headerBlock = decoded.split('\r\n\r\n')[0]
      const headerLines = headerBlock.split('\r\n')
      const valueOf = (name: string): string => {
        const line = headerLines.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
        return line ? line.slice(line.indexOf(':') + 1).trim() : ''
      }
      if (scenario.send) {
        const envelope = [
          ...extractEmails(valueOf('To')),
          ...extractEmails(valueOf('Cc')),
          ...extractEmails(valueOf('Bcc')),
        ]
        scenario.send.envelopeRecipients = envelope
        scenario.send.visibleHeaders = headerLines
          .filter((l) => !l.toLowerCase().startsWith('bcc:'))
          .join('\n')
      }
      const receipt = scenario.sendReceipt
      return {
        id: receipt?.providerMsgId ?? 'sent-msg',
        threadId: receipt?.threadId ?? threadId ?? 'sent-thread',
        internalDate: String((receipt?.sentAt ?? new Date(0)).getTime()),
      }
    },

    async listEvents() {
      countAttempt()
      maybeThrowHttp()
      return {
        items: (scenario.events ?? []).map(toGoogleEvent),
        nextSyncToken: 'SYNC-1',
      }
    },

    async createEvent(requestBody) {
      countAttempt()
      maybeThrowHttp()
      // Echo the request back as a stored event, adding the id and organizer the
      // provider owns — exactly what a real insert returns.
      return {
        id: 'evt-created',
        summary: requestBody.summary,
        description: requestBody.description,
        start: requestBody.start,
        end: requestBody.end,
        attendees: requestBody.attendees,
        organizer: { email: 'organizer@example.com' },
      }
    },
  }
}

/** The factory the contract drives: a scenario in, googleMail on mocked HTTP out. */
function makeProvider(scenario: MailProviderScenario) {
  const client = makeFakeClient(scenario)
  return googleMail({ connectionId: 'conn-1', emailAddress: 'rep@example.com' }, async () => client)
}

// The shared suite, run against googleMail. A test green here and red for Microsoft
// (or vice versa) is the seam leaking.
mailProviderContract('google', makeProvider)

// --- Per-implementation tests (SPEC-int-seam.md § Testing strategy) ---------

describe('googleMail — Gmail specifics', () => {
  it('sendEmail builds a base64url RFC 822 message that decodes with the right headers', async () => {
    let capturedRaw = ''
    const client: GmailClient = {
      ...makeFakeClient({}),
      async sendMessage(raw) {
        capturedRaw = raw
        return { id: 'PMSG', threadId: 'THREAD', internalDate: '0' }
      },
    }
    const provider = googleMail(
      { connectionId: 'conn-1', emailAddress: 'rep@example.com' },
      async () => client,
    )

    await provider.sendEmail({
      to: [{ email: 'to@example.com' }],
      cc: [{ name: 'Cee Cee', email: 'cc@example.com' }],
      subject: 'Quarterly review',
      bodyHtml: '<p>Hello &amp; welcome</p>',
    })

    const decoded = Buffer.from(capturedRaw, 'base64url').toString('utf8')
    const [headerBlock, ...bodyParts] = decoded.split('\r\n\r\n')
    // Real RFC 822: CRLF line endings, a blank line before the body.
    expect(decoded).toContain('\r\n')
    expect(headerBlock).toContain('From: rep@example.com')
    expect(headerBlock).toContain('To: to@example.com')
    expect(headerBlock).toContain('Cc: Cee Cee <cc@example.com>')
    expect(headerBlock).toContain('Subject: Quarterly review')
    expect(headerBlock).toContain('MIME-Version: 1.0')
    expect(headerBlock).toMatch(/Content-Type: text\/html/)
    // The body round-trips through base64 back to the exact sanitized HTML.
    const body = Buffer.from(bodyParts.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8')
    expect(body).toBe('<p>Hello &amp; welcome</p>')
  })

  it('a non-ASCII subject is RFC 2047-encoded so the header stays 7-bit', async () => {
    let capturedRaw = ''
    const client: GmailClient = {
      ...makeFakeClient({}),
      async sendMessage(raw) {
        capturedRaw = raw
        return { id: 'PMSG', threadId: 'THREAD', internalDate: '0' }
      },
    }
    const provider = googleMail(
      { connectionId: 'conn-1', emailAddress: 'rep@example.com' },
      async () => client,
    )

    await provider.sendEmail({
      to: [{ email: 'to@example.com' }],
      subject: 'Réunion café',
      bodyHtml: '<p>hi</p>',
    })

    const headerBlock = Buffer.from(capturedRaw, 'base64url').toString('utf8').split('\r\n\r\n')[0]
    const subjectLine = headerBlock.split('\r\n').find((l) => l.startsWith('Subject:')) ?? ''
    expect(subjectLine).toContain('=?UTF-8?B?')
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(subjectLine)).toBe(false)
  })

  it('an aged-out historyId cursor throws CursorExpiredError from the delta read', async () => {
    // A raw historyId this file did not mint is treated as a delta cursor and flows
    // straight to history.list, where Gmail's 404 becomes CursorExpiredError.
    const provider = makeProvider({ expiredCursor: 'HISTORY-STALE' })
    await expect(provider.listMessagesSince('HISTORY-STALE', 10)).rejects.toBeInstanceOf(
      CursorExpiredError,
    )
  })

  it('backfill exhaustion hands back a delta cursor that replays through history.list', async () => {
    const seeded: InboundMessage[] = [
      {
        providerMsgId: 'only-1',
        threadId: 'thread-only-1',
        from: { email: 'sender@example.com' },
        to: [{ email: 'rep@example.com' }],
        cc: [],
        subject: 'one',
        bodyHtml: null,
        bodyText: null,
        sentAt: new Date('2021-02-02T00:00:00.000Z'),
        isOutbound: false,
      },
    ]
    const provider = makeProvider({ messages: seeded })

    // One message, limit 10 → no next page → the cursor switches to the delta.
    const first = await provider.listMessagesSince(null, 10)
    expect(first.messages).toHaveLength(1)
    expect(first.nextCursor).not.toBeNull()

    // Replaying it hits history.list (mocked empty), so the next page is empty and
    // it does NOT throw — the delta path is wired end to end.
    const second = await provider.listMessagesSince(first.nextCursor, 10)
    expect(second.messages).toEqual([])
    expect(second.nextCursor).not.toBeNull()
  })

  it('getMessage decodes the HTML body and reads the SENT label as outbound', async () => {
    const seeded: InboundMessage[] = [
      {
        providerMsgId: 'msg-body',
        threadId: 'thread-body',
        from: { name: 'Rep', email: 'rep@example.com' },
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
    expect(msg.from).toEqual({ name: 'Rep', email: 'rep@example.com' })
    expect(msg.sentAt.getTime()).toBe(new Date('2021-05-05T05:05:00.000Z').getTime())
  })
})
