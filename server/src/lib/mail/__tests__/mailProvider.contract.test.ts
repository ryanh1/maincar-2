// mailProvider.contract.test.ts — proves the shared contract suite runs green
// against an in-memory fake, committed alongside it (SPEC-int-seam.md § Testing
// strategy, MAI-104 / IH-14 verification).
//
// The fake is NOT a provider. It is the reference adapter: the smallest thing that
// honours a `MailProviderScenario` exactly the way googleMail (IH-15) and
// microsoftMail (IH-16) must, so that landing this file before either implementation
// pins down what each of their `makeProvider` adapters has to do. It reaches no
// network and imports no SDK — the whole seam is exercised in memory.

import { describe, expect, it } from 'vitest'
import type {
  CalendarEvent,
  InboundMessage,
  MailProvider,
  OutboundEmail,
  SentEmail,
} from '../MailProvider.js'
import {
  CursorExpiredError,
  MailApiError,
  MailAuthError,
  RateLimitedError,
} from '../mailErrors.js'
import { mailProviderContract, type MailProviderScenario } from './mailProvider.contract.js'

/** Map a scenario's forced failure onto the typed error the seam publishes. */
function failureError(scenario: MailProviderScenario): Error {
  switch (scenario.failure) {
    case 'auth':
      return new MailAuthError()
    case 'rate-limited':
      return new RateLimitedError(scenario.retryAfterMs ?? 0)
    case 'malformed':
      return new MailApiError()
    default:
      // The caller only invokes this when scenario.failure is set.
      return new MailApiError()
  }
}

/** Order messages oldest-first by their absolute instant, the seam's read order. */
function oldestFirst(messages: InboundMessage[]): InboundMessage[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
}

/**
 * A cursor is opaque to the caller; here it encodes the next offset as a decimal
 * string. `null` starts at the beginning. Real providers carry their own token
 * (Gmail `historyId`, Graph `deltaLink`) — the contract never inspects the value,
 * only that replaying it advances.
 */
function pageFrom<T>(
  items: T[],
  cursor: string | null,
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const offset = cursor === null ? 0 : Number(cursor)
  const page = items.slice(offset, offset + limit)
  const next = offset + limit
  return { page, nextCursor: next < items.length ? String(next) : null }
}

/** Build a fake `MailProvider` that honours one scenario, entirely in memory. */
function makeFakeProvider(scenario: MailProviderScenario): MailProvider {
  const messages = scenario.messages ?? []
  const events = scenario.events ?? []

  const countAttempt = (): void => {
    if (scenario.attempts) scenario.attempts.count += 1
  }

  const guardCursor = (cursor: string | null): void => {
    if (scenario.expiredCursor != null && cursor === scenario.expiredCursor) {
      throw new CursorExpiredError()
    }
  }

  const guardFailure = (): void => {
    if (scenario.failure) throw failureError(scenario)
  }

  return {
    provider: 'google',

    async sendEmail(input: OutboundEmail): Promise<SentEmail> {
      countAttempt()
      guardFailure()
      if (scenario.send) {
        const to = input.to.map((a) => a.email)
        const cc = (input.cc ?? []).map((a) => a.email)
        const bcc = (input.bcc ?? []).map((a) => a.email)
        // bcc rides the envelope but is deliberately absent from the visible headers.
        scenario.send.envelopeRecipients = [...to, ...cc, ...bcc]
        scenario.send.visibleHeaders = `To: ${to.join(', ')}\nCc: ${cc.join(', ')}`
      }
      return (
        scenario.sendReceipt ?? {
          providerMsgId: 'fake-msg',
          threadId: input.threadId ?? 'fake-thread',
          sentAt: new Date(0),
        }
      )
    },

    async listMessagesSince(cursor, limit) {
      countAttempt()
      guardCursor(cursor)
      guardFailure()
      const { page, nextCursor } = pageFrom(oldestFirst(messages), cursor, limit)
      return { messages: page, nextCursor }
    },

    async getMessage(providerMsgId: string): Promise<InboundMessage> {
      countAttempt()
      guardFailure()
      const found = messages.find((m) => m.providerMsgId === providerMsgId)
      if (!found) throw new MailApiError('No such message.')
      return found
    },

    async listBackfillMessages(cursor, limit, _since) {
      countAttempt()
      guardCursor(cursor)
      guardFailure()
      const { page, nextCursor } = pageFrom(oldestFirst(messages), cursor, limit)
      return { messages: page, nextCursor }
    },

    async listBackfillEvents(cursor, limit, _since) {
      countAttempt()
      guardCursor(cursor)
      guardFailure()
      const { page, nextCursor } = pageFrom(events, cursor, limit)
      return { events: page, nextCursor }
    },

    async listEventsSince(cursor, limit) {
      countAttempt()
      guardCursor(cursor)
      guardFailure()
      const { page, nextCursor } = pageFrom(events, cursor, limit)
      return { events: page, nextCursor }
    },

    async createEvent(input): Promise<CalendarEvent> {
      countAttempt()
      guardFailure()
      // The provider owns the id and organizer; everything else round-trips.
      return { ...input, providerEventId: 'fake-event', organizer: null }
    },
  }
}

// Sanity guard: if this fake ever fails the shared suite, the fake and the contract
// have drifted apart — fix the fake, never weaken the contract.
describe('mailProviderContract self-check', () => {
  it('the shared suite is runnable and the in-memory fake is a valid MailProvider', () => {
    const provider = makeFakeProvider({})
    expect(typeof provider.sendEmail).toBe('function')
  })
})

mailProviderContract('in-memory fake', makeFakeProvider)
