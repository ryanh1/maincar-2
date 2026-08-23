// Route tests for POST /api/orgs/:orgId/calls.
//
// The org-isolation block at the bottom proves an unauthenticated caller is
// rejected and a non-member is answered 404 before any row is read. The rest
// proves the contract: E.164 validation, the double-call guard, that the caller
// ID and org come from the path and the locked number rather than the body, and
// that a Twilio failure does not leave a phantom "queued" row behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock, mintVoiceAccessTokenMock, hangUpCallMock, presignMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    org: { findFirst: vi.fn() },
    call: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    dispositionDef: { findFirst: vi.fn() },
    // The number→person match (lib/callMatch.ts) reads this inside the POST
    // transaction. Defaulted to "no match" in beforeEach, so an unknown number
    // still logs; the CRM-spine tests override it with a hit.
    // `updateMany` is the dial-signal write (MAI-201): a permitted dial bumps
    // timesDialed and stamps lastDialedAt on the matched row, inside the same
    // transaction as the Call.
    personPhone: { findFirst: vi.fn(), updateMany: vi.fn() },
    // The denormalized feed row the POST transaction appends (MAI-140 T12). It is
    // written through crm/activityFeed.ts with the SAME tx the Call is created on,
    // and $transaction below hands the route this very mock as that tx — so the
    // upsert lands here, and a test can prove the feed row and the call are one
    // unit of work.
    activityEntry: { upsert: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
  mintVoiceAccessTokenMock: vi.fn(),
  hangUpCallMock: vi.fn(),
  presignMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
// The Twilio wrapper, not the SDK. Mocking our own module is what makes the
// route testable without a network, an account, or a cent of spend — and it is
// only possible because the SDK is constructed in exactly one file. Nothing in
// this route calls Twilio to place a call any more — the browser Voice SDK does
// that — so the only Twilio functions left are minting the browser's access
// token and hanging an active call up.
vi.mock('../../../dependencies/twilio.js', () => ({
  mintVoiceAccessToken: mintVoiceAccessTokenMock,
  hangUpCall: hangUpCallMock,
}))
// The S3 wrapper, not the AWS SDK. Mocking our own module is what lets the detail
// route be tested without an object store, credentials, or a signing round-trip —
// and, as with Twilio, it is only possible because the SDK lives in exactly one
// file. The route hands this a stored object key; the test asserts on that.
vi.mock('../../../dependencies/s3.js', () => ({
  getRecordingDownloadUrl: presignMock,
  RECORDING_URL_TTL_SECONDS: 3600,
}))

import app from '../../app.js'
import { resetCallCreationRateLimitForTests } from '../calls.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/calls`

const VALID_BODY = { toE164: '+13035550199' }

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@orga.com',
    firstName: 'Al',
    lastName: 'Pha',
    title: null,
    imageUrl: null,
    roles: ['basic'],
    enabled: true,
    timeZone: 'America/New_York',
    currentOrgId: ORG_A,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a',
    userId: 'user-a',
    orgId: ORG_A,
    roles: ['basic'],
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    orgId: ORG_A,
    userId: 'user-a',
    fromE164: '+12025550123',
    toE164: '+13035550199',
    direction: 'outbound',
    status: 'queued',
    twilioCallSid: null,
    recordingConsent: null,
    recordingPlanned: true,
    recordingReason: 'allowed',
    destinationState: 'CO',
    recordingEnabled: null,
    recordingUrl: null,
    transcriptStatus: 'pending',
    transcript: null,
    dispositionId: null,
    noteText: null,
    durationS: null,
    startedAt: null,
    endedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Signs the caller in. `membership` is what they hold in the org they ask about. */
function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  // The voice-token failure case gives this mock a throwing implementation.
  // Reset implementations too, so it cannot leak into the following tenant
  // boundary case and mask the route's intended 404.
  vi.resetAllMocks()
  resetCallCreationRateLimitForTests()
  // A matched person is checked against their local calling hours. Freeze only
  // Date at a permitted instant so these route tests do not turn red after 9 PM
  // in New York while Supertest's real timers continue to run.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  authAs()
  // A locked active number is the default; the no-active-number test overrides
  // this to an empty result.
  prismaMock.$queryRaw.mockResolvedValue([
    { id: 'num-1', e164: '+12025550123', isActiveForOutbound: true },
  ])
  prismaMock.call.findFirst.mockResolvedValue(null)
  prismaMock.call.findMany.mockResolvedValue([callRow()])
  prismaMock.call.count.mockResolvedValue(1)
  prismaMock.call.create.mockResolvedValue(callRow())
  prismaMock.org.findFirst.mockResolvedValue({
    recordCalls: true,
    recordingBlockedStates: ['CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NV', 'NH', 'OR', 'PA', 'WA', 'UNKNOWN'],
  })
  prismaMock.call.updateMany.mockResolvedValue({ count: 1 })
  // Default: the dialed number matches no person, so a call to it still logs with
  // null CRM links. The CRM-spine tests override this to a match.
  prismaMock.personPhone.findFirst.mockResolvedValue(null)
  prismaMock.personPhone.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.activityEntry.upsert.mockResolvedValue({ id: 'feed-1' })
  // Runs the callback against the same mock, so the assertions below see the
  // reads and writes the route makes INSIDE the transaction.
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock))
  mintVoiceAccessTokenMock.mockReturnValue({ token: 'fake.jwt.token', identity: 'user-a', ttlSeconds: 3600 })
  hangUpCallMock.mockResolvedValue({ sid: 'CA123', status: 'completed' })
  // A stand-in for the URL the real presigner signs. The route's job is to call
  // this with the stored key and return what comes back, never to sign itself.
  presignMock.mockResolvedValue('https://minio.local/maincar2-local/recordings/call-1.mp3?sig=abc')
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// GET — voice-token: mints a browser Voice SDK access token
// ============================================================
describe('GET /api/orgs/:orgId/calls/voice-token', () => {
  it('mints a token for the caller and returns it', async () => {
    const res = await request(app).get(`${URL_A}/voice-token`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ token: 'fake.jwt.token', identity: 'user-a', ttlSeconds: 3600 })
    expect(mintVoiceAccessTokenMock).toHaveBeenCalledWith('user-a')
  })

  it('400s with an honest message when Twilio voice is not configured', async () => {
    mintVoiceAccessTokenMock.mockImplementation(() => {
      throw new Error('Browser calling is not configured.')
    })

    const res = await request(app).get(`${URL_A}/voice-token`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Browser calling is not set up for this organization yet.')
  })

  it('401s without auth, and mints nothing', async () => {
    const res = await request(app).get(`${URL_A}/voice-token`)

    expect(res.status).toBe(401)
    expect(mintVoiceAccessTokenMock).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, and mints nothing', async () => {
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_B}/calls/voice-token`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(mintVoiceAccessTokenMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list, paginate, sort, search
// ============================================================
describe('GET /api/orgs/:orgId/calls', () => {
  it('returns the org’s calls with the pagination envelope', async () => {
    prismaMock.call.findMany.mockResolvedValue([callRow({ id: 'c1' }), callRow({ id: 'c2' })])
    prismaMock.call.count.mockResolvedValue(2)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.calls.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2'])
    expect(res.body.total).toBe(2)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(25)
  })

  it('scopes both the count and the page to the org in the path', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    expect(prismaMock.call.count).toHaveBeenCalledWith({ where: { orgId: ORG_A } })
    expect(prismaMock.call.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG_A })
  })

  it('returns the history fields, including duration and the timestamps', async () => {
    prismaMock.call.findMany.mockResolvedValue([
      callRow({ durationS: 42, startedAt: NOW, endedAt: NOW }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(Object.keys(res.body.calls[0]).sort()).toEqual([
      'createdAt',
      'direction',
      'durationS',
      'endedAt',
      'fromE164',
      'id',
      'recordingPlanned',
      'recordingReason',
      'startedAt',
      'status',
      'toE164',
      'transcriptStatus',
      'twilioCallSid',
    ])
    expect(res.body.calls[0].durationS).toBe(42)
    expect(res.body.calls[0].startedAt).toBe(NOW.toISOString())
    // The Transcript column reads this off the row rather than fetching detail.
    expect(res.body.calls[0].transcriptStatus).toBe('pending')
  })

  it('defaults to page 1, limit 25, newest first', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    const args = prismaMock.call.findMany.mock.calls[0][0]
    expect(args.skip).toBe(0)
    expect(args.take).toBe(25)
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }])
  })

  it('turns page and limit into skip and take', async () => {
    await request(app).get(`${URL_A}?page=3&limit=10`).set('Authorization', AUTH)

    const args = prismaMock.call.findMany.mock.calls[0][0]
    expect(args.skip).toBe(20)
    expect(args.take).toBe(10)
    expect(prismaMock.call.count).toHaveBeenCalledWith({ where: { orgId: ORG_A } })
  })

  it('clamps limit to the 100 ceiling', async () => {
    const res = await request(app).get(`${URL_A}?limit=500`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('at most 100')
  })

  it('400s a limit below 1 and a page below 1', async () => {
    const low = await request(app).get(`${URL_A}?limit=0`).set('Authorization', AUTH)
    expect(low.status).toBe(400)
    const zeroPage = await request(app).get(`${URL_A}?page=0`).set('Authorization', AUTH)
    expect(zeroPage.status).toBe(400)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })

  it('searches the destination number by the digits in q', async () => {
    await request(app).get(`${URL_A}?q=201`).set('Authorization', AUTH)

    expect(prismaMock.call.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      toE164: { contains: '201' },
    })
    expect(prismaMock.call.count).toHaveBeenCalledWith({
      where: { orgId: ORG_A, toE164: { contains: '201' } },
    })
  })

  it('treats a blank q as no filter', async () => {
    await request(app).get(`${URL_A}?q=`).set('Authorization', AUTH)

    expect(prismaMock.call.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG_A })
  })

  it('400s a q that is not phone-number digits', async () => {
    const res = await request(app).get(`${URL_A}?q=abc`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })

  it.each([
    ['createdAt', 'asc'],
    ['toE164', 'desc'],
    ['status', 'asc'],
    ['durationS', 'desc'],
  ])('sorts by %s %s', async (sort, dir) => {
    await request(app).get(`${URL_A}?sort=${sort}&dir=${dir}`).set('Authorization', AUTH)

    const orderBy = prismaMock.call.findMany.mock.calls[0][0].orderBy
    // createdAt is its own tie-break, so it orders by one key; the others carry a
    // createdAt tie-break beneath the chosen column.
    if (sort === 'createdAt') {
      expect(orderBy).toEqual([{ createdAt: dir }])
    } else {
      expect(orderBy).toEqual([{ [sort]: dir }, { createdAt: 'desc' }])
    }
  })

  it('400s an unknown sort column, and reads nothing', async () => {
    const res = await request(app).get(`${URL_A}?sort=userId`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })

  it('400s an unknown sort direction', async () => {
    const res = await request(app).get(`${URL_A}?dir=sideways`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
  })

  it('returns an empty page and a zero total when the org has no calls', async () => {
    prismaMock.call.findMany.mockResolvedValue([])
    prismaMock.call.count.mockResolvedValue(0)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.calls).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(25)
  })
})

// ============================================================
// GET — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('GET /api/orgs/:orgId/calls — org isolation', () => {
  it('401s without auth, and reads nothing', async () => {
    const res = await request(app).get(URL_A)

    expect(res.status).toBe(401)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
    expect(prismaMock.call.count).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any call', async () => {
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_B}/calls`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
    expect(prismaMock.call.count).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.call.findMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET /:id — one call, with its transcript and a signed recording link
// ============================================================
describe('GET /api/orgs/:orgId/calls/:id', () => {
  it('returns the full call, including the transcript', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({
        id: 'call-9',
        status: 'completed',
        recordingEnabled: true,
        recordingUrl: 'recordings/call-9.mp3',
        transcriptStatus: 'done',
        transcript: 'Hello, this is the transcript.',
        durationS: 73,
        startedAt: NOW,
        endedAt: NOW,
      }),
    )

    const res = await request(app).get(`${URL_A}/call-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    // Read by id AND orgId together — the tenant key is half the lookup.
    expect(prismaMock.call.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'call-9', orgId: ORG_A },
    }))
    // The whole record a detail view needs, and no tenant internals.
    expect(Object.keys(res.body.call).sort()).toEqual([
      'createdAt',
      'destinationState',
      'direction',
      'disposition',
      'durationS',
      'endedAt',
      'fromE164',
      'id',
      'nextSteps',
      'noteText',
      'recordingEnabled',
      'recordingPlanned',
      'recordingReason',
      'recordingUrl',
      'review',
      'startedAt',
      'status',
      'toE164',
      'transcript',
      'transcriptStatus',
      'twilioCallSid',
    ])
    expect(res.body.call.id).toBe('call-9')
    expect(res.body.call.transcript).toBe('Hello, this is the transcript.')
    expect(res.body.call.transcriptStatus).toBe('done')
    expect(res.body.call.durationS).toBe(73)
    expect(res.body.call.nextSteps).toEqual([])
  })

  it('returns one review read model with CRM context, a signed audio source, timed transcript data, and speakers', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({
        id: 'call-review',
        recordingStatus: 'stored',
        recordingUrl: 'recordings/call-review.mp3',
        transcriptStatus: 'done',
        transcript: 'Legacy compatibility text.',
        person: {
          id: 'person-1', firstName: 'Jordan', lastName: 'Lee', preferredFirstName: null, title: 'VP Sales',
          persona: 'champion', lastContactedAt: NOW,
        },
        company: { id: 'company-1', name: 'Acme' },
        deal: { id: 'deal-1', name: 'Renewal', status: 'open' },
        finalTranscript: {
          id: 'transcript-1',
          provider: 'deepgram',
          plainText: 'Hello there.',
          segments: [
            {
              id: 'segment-1',
              position: 0,
              speakerKey: 'channel-0',
              startMs: 0,
              endMs: 700,
              text: 'Hello there.',
              words: [{ word: 'Hello', startMs: 0, endMs: 350 }],
            },
          ],
        },
        speakers: [
          {
            id: 'speaker-1',
            speakerKey: 'channel-0',
            displayName: 'Jordan Lee',
            source: 'manual',
            confidence: 1,
            confirmedAt: NOW,
            manualOverride: true,
            person: { id: 'person-1', firstName: 'Jordan', lastName: 'Lee', preferredFirstName: null },
          },
        ],
      }),
    )
    presignMock.mockResolvedValue('https://minio.local/recordings/call-review.mp3?sig=xyz')

    const res = await request(app).get(`${URL_A}/call-review`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.call.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        person: { select: expect.objectContaining({ persona: true, lastContactedAt: true }) },
      }),
    }))
    expect(res.body.call.review).toMatchObject({
      crm: {
        person: {
          id: 'person-1', firstName: 'Jordan', lastName: 'Lee', title: 'VP Sales',
          persona: 'champion', lastContactedAt: NOW.toISOString(),
        },
        company: { id: 'company-1', name: 'Acme' },
        deal: { id: 'deal-1', name: 'Renewal', status: 'open' },
      },
      recording: {
        state: 'ready',
        source: { kind: 'audio', url: 'https://minio.local/recordings/call-review.mp3?sig=xyz' },
      },
      transcript: {
        state: 'ready',
        pass: {
          id: 'transcript-1',
          provider: 'deepgram',
          plainText: 'Hello there.',
          segments: [{ speakerKey: 'channel-0', startMs: 0, endMs: 700 }],
        },
      },
      speakers: [
        {
          id: 'speaker-1',
          speakerKey: 'channel-0',
          displayName: 'Jordan Lee',
          source: 'manual',
          manualOverride: true,
          person: { id: 'person-1', firstName: 'Jordan', lastName: 'Lee' },
        },
      ],
    })
    expect(new Date(res.body.call.review.recording.source.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('returns independent partial-ready recording and transcript states', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({
        id: 'call-partial-ready',
        recordingStatus: 'stored',
        recordingUrl: 'recordings/call-partial-ready.mp3',
        transcriptStatus: 'pending',
        recordingEnabled: true,
      }),
    )

    const res = await request(app).get(`${URL_A}/call-partial-ready`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.call.review.recording.state).toBe('ready')
    expect(res.body.call.review.recording.source).toMatchObject({ kind: 'audio' })
    expect(res.body.call.review.transcript).toEqual({ state: 'processing', pass: null })
  })

  it('does not expose a raw recording key when signing the source fails', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({ id: 'call-missing-source', recordingStatus: 'stored', recordingUrl: 'recordings/missing.mp3' }),
    )
    presignMock.mockRejectedValue(new Error('source is unavailable'))

    const res = await request(app).get(`${URL_A}/call-missing-source`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.call.recordingUrl).toBeNull()
    expect(res.body.call.review.recording).toEqual({ state: 'missing', source: null })
    expect(JSON.stringify(res.body)).not.toContain('recordings/missing.mp3')
  })

  it('reports consent-unavailable recording and transcript states without signing a source', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({
        id: 'call-without-consent',
        recordingPlanned: false,
        recordingReason: 'two-party-consent-state',
        recordingConsent: 'declined',
        recordingUrl: 'recordings/consent-withdrawn.mp3',
        transcriptStatus: 'skipped-not-recorded',
      }),
    )

    const res = await request(app).get(`${URL_A}/call-without-consent`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.call.review.recording).toEqual({ state: 'unavailable-by-consent', source: null })
    expect(res.body.call.review.transcript).toEqual({ state: 'unavailable-by-consent', pass: null })
    expect(presignMock).not.toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toContain('recordings/consent-withdrawn.mp3')
  })

  it('signs the stored recording key at request time and returns the presigned URL', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({ id: 'call-9', recordingUrl: 'recordings/call-9.mp3' }),
    )
    presignMock.mockResolvedValue('https://minio.local/maincar2-local/recordings/call-9.mp3?sig=xyz')

    const res = await request(app).get(`${URL_A}/call-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    // The stored value is a bare KEY; the route signs it rather than echoing it.
    expect(presignMock).toHaveBeenCalledTimes(1)
    expect(presignMock).toHaveBeenCalledWith('recordings/call-9.mp3')
    expect(res.body.call.recordingUrl).toBe(
      'https://minio.local/maincar2-local/recordings/call-9.mp3?sig=xyz',
    )
    // Never the raw key — that is the whole point of signing.
    expect(res.body.call.recordingUrl).not.toBe('recordings/call-9.mp3')
  })

  it('returns a null recordingUrl and signs nothing when there is no recording', async () => {
    prismaMock.call.findFirst.mockResolvedValue(callRow({ id: 'call-9', recordingUrl: null }))

    const res = await request(app).get(`${URL_A}/call-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.call.recordingUrl).toBeNull()
    expect(presignMock).not.toHaveBeenCalled()
  })

  it('404s a call id that does not exist', async () => {
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await request(app).get(`${URL_A}/nope`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Call not found')
    expect(presignMock).not.toHaveBeenCalled()
  })

  it('404s a call that belongs to another org — never a 403', async () => {
    // The row exists, but not in this org: the id+orgId where clause finds
    // nothing, so the caller cannot even learn the call is real.
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await request(app).get(`${URL_A}/call-in-org-b`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Call not found')
    expect(prismaMock.call.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'call-in-org-b', orgId: ORG_A },
    }))
  })
})

// ============================================================
// GET /:id — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('GET /api/orgs/:orgId/calls/:id — org isolation', () => {
  it('401s without auth, and reads nothing', async () => {
    const res = await request(app).get(`${URL_A}/call-9`)

    expect(res.status).toBe(401)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(presignMock).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any call', async () => {
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_B}/calls/call-9`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).get(`${URL_A}/call-9`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — happy path
// ============================================================
describe('POST /api/orgs/:orgId/calls', () => {
  it('allows three calls per minute for one user, then rejects the fourth with Retry-After', async () => {
    for (const toE164 of ['+13035550190', '+13035550191', '+13035550192']) {
      const allowed = await request(app).post(URL_A).set('Authorization', AUTH).send({ toE164 })
      expect(allowed.status).toBe(201)
    }

    const rejected = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toE164: '+13035550193' })

    expect(rejected.status).toBe(429)
    expect(rejected.body).toEqual({ error: 'Too many calls. Try again in 60 seconds.' })
    expect(rejected.headers['retry-after']).toBe('60')
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3)
  })

  it('keeps unexpected call-creation failures generic and free of internal details', async () => {
    prismaMock.org.findFirst.mockResolvedValue(null)

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(JSON.stringify(res.body)).not.toContain('recording policy')
  })

  it('creates a queued call and returns it with no SID yet — the browser Device dials, not this route', async () => {
    prismaMock.call.create.mockResolvedValue(callRow({ id: 'call-1', status: 'queued' }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(res.body.call.status).toBe('queued')
    expect(res.body.call.direction).toBe('outbound')
    expect(res.body.call.fromE164).toBe('+12025550123')
    expect(res.body.call.toE164).toBe('+13035550199')
    // Nothing here calls Twilio, so no SID exists yet — it lands once the browser
    // Device connects and Twilio fetches POST /api/twilio/voice.
    expect(res.body.call.twilioCallSid).toBeNull()
  })

  it('uses an assigned active number selected for this call without changing the primary', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'num-primary', e164: '+12025550123', isActiveForOutbound: true },
      { id: 'num-secondary', e164: '+12025550124', isActiveForOutbound: false },
    ])
    prismaMock.call.create.mockResolvedValue(callRow({ fromE164: '+12025550124' }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ ...VALID_BODY, phoneNumberId: 'num-secondary' })

    expect(res.status).toBe(201)
    expect(res.body.call.fromE164).toBe('+12025550124')
    expect(prismaMock.call.create.mock.calls[0][0].data.fromE164).toBe('+12025550124')
  })

  it('allows an explicit active selection when the caller has no primary number', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'num-secondary', e164: '+12025550124', isActiveForOutbound: false },
    ])
    prismaMock.call.create.mockResolvedValue(callRow({ fromE164: '+12025550124' }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ ...VALID_BODY, phoneNumberId: 'num-secondary' })

    expect(res.status).toBe(201)
    expect(res.body.call.fromE164).toBe('+12025550124')
  })

  it('appends the ONE activity-feed row, inside the same transaction as the call (MAI-140)', async () => {
    prismaMock.call.create.mockResolvedValue(callRow({ id: 'call-1', status: 'queued' }))

    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    // Exactly one, and an UPSERT rather than a create — so a retried job or a
    // redelivered webhook refreshes the line instead of appending a second copy.
    expect(prismaMock.activityEntry.upsert).toHaveBeenCalledTimes(1)
    const args = prismaMock.activityEntry.upsert.mock.calls[0]![0] as {
      where: { orgId_sourceType_sourceId: Record<string, string> }
      create: Record<string, unknown>
    }
    // Keyed on all three NON-NULL columns, org first: a source id colliding across
    // tenants can never make one org's write land on another org's row.
    expect(args.where.orgId_sourceType_sourceId).toEqual({
      orgId: ORG_A,
      sourceType: 'call',
      sourceId: 'call-1',
    })
    // The row paints itself: the number dialed is in the summary, so the feed needs
    // no join back to Call.
    expect(args.create).toMatchObject({
      orgId: ORG_A,
      sourceType: 'call',
      sourceId: 'call-1',
      direction: 'outbound',
      createdByUserId: 'user-a',
    })
    expect(args.create.summary).toContain('+13035550199')

    // INSIDE the transaction, and after the call it summarizes. The route hands
    // recordActivityInTx the tx client, never the singleton — which the type system
    // also enforces (see crm/activityFeed.ts → ActivityFeedClient).
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    const createOrder = prismaMock.call.create.mock.invocationCallOrder[0]!
    const feedOrder = prismaMock.activityEntry.upsert.mock.invocationCallOrder[0]!
    expect(createOrder).toBeLessThan(feedOrder)
  })

  it('does not write a feed row when the call itself is refused', async () => {
    // A call already in flight to this number: the guard throws before the create,
    // so neither the call nor its feed line is written.
    prismaMock.call.findFirst.mockResolvedValue(callRow({ id: 'call-live', status: 'ringing' }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(prismaMock.call.create).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.upsert).not.toHaveBeenCalled()
  })

  it('returns exactly the fields the client needs, and no others', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(Object.keys(res.body.call).sort()).toEqual([
      'createdAt',
      'direction',
      'fromE164',
      'id',
      'recordingPlanned',
      'recordingReason',
      'status',
      'toE164',
      'twilioCallSid',
    ])
  })

  it('writes the row with the org from the path and the caller from the token, never the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      // A body that lies about who and where. None of it must reach the write.
      .send({ ...VALID_BODY, orgId: ORG_B, userId: 'someone-else', fromE164: '+19995550000' })

    expect(prismaMock.call.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.call.create.mock.calls[0][0].data).toMatchObject({
      orgId: ORG_A,
      userId: 'user-a',
      fromE164: '+12025550123',
      toE164: '+13035550199',
      direction: 'outbound',
      status: 'queued',
      recordingPlanned: true,
      recordingReason: 'allowed',
      destinationState: 'CO',
    })
  })

  it('locks the caller’s active number FOR UPDATE before it counts calls in flight', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect((prismaMock.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain('FOR UPDATE')
    // The lock is taken inside the transaction, before the create.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    const lockOrder = prismaMock.$queryRaw.mock.invocationCallOrder[0]!
    const createOrder = prismaMock.call.create.mock.invocationCallOrder[0]!
    expect(lockOrder).toBeLessThan(createOrder)
  })

  it('never calls Twilio, and writes no updateMany — the browser Device dials, not this route', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(prismaMock.call.update).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
    expect(hangUpCallMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — invalid input
// ============================================================
describe('POST /api/orgs/:orgId/calls — invalid input', () => {
  it('400s a missing toE164, and writes nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ recordingConsent: 'granted' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Enter a number to call, and send it as toE164.')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('400s a number that is not E.164, without a raw zod dump', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toE164: '3035550199', recordingConsent: 'granted' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('E.164')
    expect(res.body.error).not.toContain('ZodError')
    expect(Object.keys(res.body)).toEqual(['error'])
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('ignores a legacy recordingConsent value and keeps the server policy decision', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toE164: '+13035550199', recordingConsent: 'declined' })

    expect(res.status).toBe(201)
    expect(prismaMock.call.create.mock.calls[0][0].data).toMatchObject({
      recordingPlanned: true,
      recordingReason: 'allowed',
    })
  })

  it('does not accept a client recordingConsent as a policy override', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ toE164: '+13035550199', recordingConsent: 'maybe' })

    expect(res.status).toBe(201)
    expect(prismaMock.call.create.mock.calls[0][0].data).toMatchObject({
      recordingPlanned: true,
      recordingReason: 'allowed',
    })
  })

  it('400s when the caller has no active number, and dials nothing', async () => {
    prismaMock.$queryRaw.mockResolvedValue([])

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(
      'Activate a phone number for outbound calling before you place a call.',
    )
    expect(prismaMock.call.create).not.toHaveBeenCalled()
  })

  it('400s an unavailable selected number without writing a call', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ ...VALID_BODY, phoneNumberId: 'num-not-assigned-to-the-caller' })

    expect(res.status).toBe(400)
    expect(prismaMock.call.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — the double-call guard
// ============================================================
describe('POST /api/orgs/:orgId/calls — double-call guard', () => {
  it('409s when a call to the same number is already in flight, and creates no second row', async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      callRow({ id: 'call-inflight', status: 'ringing' }),
    )

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already have a call')
    // The call already up is handed back so the client can adopt it.
    expect(res.body.call.id).toBe('call-inflight')
    expect(prismaMock.call.create).not.toHaveBeenCalled()
  })

  it('scopes the in-flight check to this user, this org, this number, and the live statuses', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({
      where: {
        orgId: ORG_A,
        userId: 'user-a',
        toE164: '+13035550199',
        status: { in: ['queued', 'ringing', 'in-progress'] },
      },
    })
  })
})

// ============================================================
// POST — the CRM-spine match (MAI-132)
// ============================================================
describe('POST /api/orgs/:orgId/calls — CRM-spine match', () => {
  it('links the call to the person and their company when the dialed number is known', async () => {
    // The number being dialed matches a PersonPhone whose person belongs to a company.
    prismaMock.personPhone.findFirst.mockResolvedValue({
      person: { id: 'person-7', companyId: 'company-3' },
    })

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    // The match is scoped to the org in the path and run against the dialed number.
    expect(prismaMock.personPhone.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.personPhone.findFirst.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      e164: '+13035550199',
    })
    // The link is written onto the Call row: person and their company, deal null.
    expect(prismaMock.call.create.mock.calls[0][0].data).toMatchObject({
      personId: 'person-7',
      companyId: 'company-3',
      dealId: null,
    })
  })

  it('links the person with a null company when the matched person has no company', async () => {
    prismaMock.personPhone.findFirst.mockResolvedValue({
      person: { id: 'person-7', companyId: null },
    })

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(prismaMock.call.create.mock.calls[0][0].data).toMatchObject({
      personId: 'person-7',
      companyId: null,
      dealId: null,
    })
  })

  it('still logs a call to an unknown number, with all three links null', async () => {
    // The default: findFirst resolves null — no person owns this number.
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(prismaMock.call.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.call.create.mock.calls[0][0].data).toMatchObject({
      personId: null,
      companyId: null,
      dealId: null,
    })
  })
})

// ============================================================
// POST — the dial-time compliance guard (MAI-201)
// ============================================================
// The guard's own logic — the order, the sentences, every timezone edge — is
// proved in lib/__tests__/dialGuard.test.ts. These prove the ROUTE: that a
// refusal is a 403 carrying the reason, that nothing is written when one fires,
// and that a permitted dial records itself on the matched number.

/** A matched PersonPhone row in the shape lib/callMatch.ts selects. */
function phoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'phone-9',
    isDnc: false,
    dncReason: null,
    status: 'reachable',
    reason: null,
    person: { id: 'person-7', companyId: 'company-3', timeZone: 'America/New_York' },
    ...overrides,
  }
}

describe('POST /api/orgs/:orgId/calls — the compliance guard', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Freeze the wall clock. Only Date is faked, so supertest's own timers still run. */
  function at(instant: string): void {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(instant))
  }

  it('refuses a do-not-call number with 403 and the reason the dialer shows', async () => {
    prismaMock.personPhone.findFirst.mockResolvedValue(
      phoneRow({ isDnc: true, dncReason: 'asked to be removed' }),
    )

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe(
      'This number is on the do-not-call list (asked to be removed). Call a different number for this person.',
    )
    // The discriminator the client reads off the body, so the dialer can branch on
    // WHICH rule stopped it without matching on the sentence.
    expect(res.body.status).toBe('dnc')
  })

  it('writes nothing at all when the guard refuses — no call, no feed row, no dial signal', async () => {
    prismaMock.personPhone.findFirst.mockResolvedValue(phoneRow({ isDnc: true }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(403)
    expect(prismaMock.call.create).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.upsert).not.toHaveBeenCalled()
    expect(prismaMock.personPhone.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a dial outside the callee’s local calling hours', async () => {
    // 03:00 UTC is 11:00 PM the previous evening in New York.
    at('2026-08-22T03:00:00.000Z')
    prismaMock.personPhone.findFirst.mockResolvedValue(phoneRow())

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(403)
    expect(res.body.status).toBe('outside_calling_hours')
    expect(res.body.error).toContain('11:00 PM EDT for this person')
    expect(prismaMock.call.create).not.toHaveBeenCalled()
  })

  it('judges the hours in the CALLEE’s zone, not the server’s or the rep’s', async () => {
    // The same instant: 4:00 PM in New York, and 1:00 PM in Los Angeles. Both are
    // inside the window, so the call goes through — and the rep's own stored zone
    // (America/New_York on the user row) never enters into it.
    at('2026-08-21T20:00:00.000Z')
    prismaMock.personPhone.findFirst.mockResolvedValue(
      phoneRow({ person: { id: 'person-7', companyId: null, timeZone: 'America/Los_Angeles' } }),
    )

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
  })

  it('refuses a number marked dead, after the hours check has passed', async () => {
    at('2026-08-21T16:00:00.000Z') // noon in New York
    prismaMock.personPhone.findFirst.mockResolvedValue(
      phoneRow({ status: 'dead', reason: 'no_longer_in_service' }),
    )

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(403)
    expect(res.body.status).toBe('number_dead')
    expect(res.body.error).toBe(
      'This number is marked dead (no longer in service). Call a different number for this person.',
    )
  })

  it('lets an unknown number through — there is no saved row to check it against', async () => {
    // Midnight in New York, an hour that would refuse a KNOWN person. The default
    // findFirst resolves null, so nothing is known about this number at all.
    at('2026-08-21T04:00:00.000Z')

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
  })

  it('reads the guard fields and the CRM links from ONE row, so they cannot disagree', async () => {
    prismaMock.personPhone.findFirst.mockResolvedValue(phoneRow())

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(prismaMock.personPhone.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.personPhone.findFirst.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      e164: '+13035550199',
    })
  })
})

// ============================================================
// POST — the dial signals (MAI-201, spec §A7)
// ============================================================
describe('POST /api/orgs/:orgId/calls — dial signals', () => {
  it('increments timesDialed and stamps lastDialedAt on the matched number', async () => {
    prismaMock.personPhone.findFirst.mockResolvedValue(phoneRow())

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(prismaMock.personPhone.updateMany).toHaveBeenCalledTimes(1)
    const args = prismaMock.personPhone.updateMany.mock.calls[0][0]
    // updateMany with orgId, never update by id — the tenant key lives in the
    // where clause (rules/database-and-prisma.md).
    expect(args.where).toEqual({ id: 'phone-9', orgId: ORG_A })
    expect(args.data.timesDialed).toEqual({ increment: 1 })
    expect(args.data.lastDialedAt).toBeInstanceOf(Date)
  })

  it('writes the signal in the SAME transaction as the call, so the two cannot diverge', async () => {
    prismaMock.personPhone.findFirst.mockResolvedValue(phoneRow())

    await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    // $transaction is mocked to run its callback against this same client, so a
    // signal recorded here is a signal recorded inside the unit of work. One
    // transaction, not two.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.call.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.personPhone.updateMany).toHaveBeenCalledTimes(1)
  })

  it('writes no signal for an unknown number, and still logs the call', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(201)
    expect(prismaMock.call.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.personPhone.updateMany).not.toHaveBeenCalled()
  })

  it('does not count a dial that never happened — a double-call 409 writes no signal', async () => {
    prismaMock.personPhone.findFirst.mockResolvedValue(phoneRow())
    prismaMock.call.findFirst.mockResolvedValue(callRow({ status: 'ringing' }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(409)
    expect(prismaMock.personPhone.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('POST /api/orgs/:orgId/calls — org isolation', () => {
  it('401s without auth, and reads nothing', async () => {
    const res = await request(app).post(URL_A).send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any number', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/calls`)
      .set('Authorization', AUTH)
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

// ============================================================
// PATCH /:id/disposition — a rep can replace an automatic outcome
// ============================================================
describe('PATCH /api/orgs/:orgId/calls/:id/disposition', () => {
  it('replaces an automatic outcome and returns the rep’s final selected disposition', async () => {
    prismaMock.dispositionDef.findFirst.mockResolvedValue({ id: 'rep-disposition' })
    prismaMock.call.findFirst.mockResolvedValue(callRow({
      dispositionId: 'rep-disposition',
      disposition: {
        id: 'rep-disposition', value: 'callback', label: 'Call back', color: 'option-7', icon: null, category: 'connected',
      },
      nextSteps: [],
    }))

    const res = await request(app)
      .patch(`${URL_A}/call-1/disposition`)
      .set('Authorization', AUTH)
      .send({ dispositionId: 'rep-disposition' })

    expect(res.status).toBe(200)
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'call-1', orgId: ORG_A },
      data: { dispositionId: 'rep-disposition' },
    })
    expect(res.body.call.disposition).toEqual({
      id: 'rep-disposition', value: 'callback', label: 'Call back', color: 'option-7', icon: null, category: 'connected',
    })
  })
})

// ============================================================
// DELETE /:id — hang up an active call
// ============================================================
describe('DELETE /api/orgs/:orgId/calls/:id', () => {
  it('hangs up through Twilio, cancels the row with an endedAt, and returns the updated call', async () => {
    // The read finds an in-progress call with a SID; the re-read after the write
    // sees it settled to canceled with an endedAt.
    prismaMock.call.findFirst
      .mockResolvedValueOnce(callRow({ id: 'call-1', status: 'in-progress', twilioCallSid: 'CA123' }))
      .mockResolvedValueOnce(
        callRow({ id: 'call-1', status: 'canceled', twilioCallSid: 'CA123', endedAt: NOW }),
      )

    const res = await request(app).delete(`${URL_A}/call-1`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    // Twilio was asked to drop the live leg, by the stored SID.
    expect(hangUpCallMock).toHaveBeenCalledTimes(1)
    expect(hangUpCallMock).toHaveBeenCalledWith('CA123')
    // Settled with an org-scoped updateMany, canceled + endedAt, never update-by-id.
    expect(prismaMock.call.update).not.toHaveBeenCalled()
    const settle = prismaMock.call.updateMany.mock.calls[0][0]
    expect(settle.where).toEqual({
      id: 'call-1',
      orgId: ORG_A,
      status: { in: ['queued', 'ringing', 'in-progress'] },
    })
    expect(settle.data.status).toBe('canceled')
    expect(settle.data.endedAt).toBeInstanceOf(Date)
    // The response carries the updated call.
    expect(res.body.call.id).toBe('call-1')
    expect(res.body.call.status).toBe('canceled')
    expect(res.body.call.endedAt).toBe(NOW.toISOString())
  })

  it('cancels a queued call that has no SID yet without calling Twilio', async () => {
    prismaMock.call.findFirst
      .mockResolvedValueOnce(callRow({ id: 'call-1', status: 'queued', twilioCallSid: null }))
      .mockResolvedValueOnce(
        callRow({ id: 'call-1', status: 'canceled', twilioCallSid: null, endedAt: NOW }),
      )

    const res = await request(app).delete(`${URL_A}/call-1`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    // No live leg exists to hang up, so Twilio is never called.
    expect(hangUpCallMock).not.toHaveBeenCalled()
    // The row is still canceled in the database.
    expect(prismaMock.call.updateMany.mock.calls[0][0].data.status).toBe('canceled')
    expect(res.body.call.status).toBe('canceled')
  })

  it('400s a call that has already ended, and neither hangs up nor writes', async () => {
    prismaMock.call.findFirst.mockResolvedValueOnce(
      callRow({ id: 'call-1', status: 'completed', twilioCallSid: 'CA123' }),
    )

    const res = await request(app).delete(`${URL_A}/call-1`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('already ended')
    expect(hangUpCallMock).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })

  it('400s when a racing hang-up already settled the row', async () => {
    // The read still sees it in flight, but the compare-and-set write finds no
    // in-flight row to move: another request beat us to it.
    prismaMock.call.findFirst.mockResolvedValueOnce(
      callRow({ id: 'call-1', status: 'ringing', twilioCallSid: 'CA123' }),
    )
    prismaMock.call.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(`${URL_A}/call-1`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('already ended')
  })

  it('404s a call id that does not exist, and hangs up nothing', async () => {
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await request(app).delete(`${URL_A}/nope`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Call not found')
    expect(hangUpCallMock).not.toHaveBeenCalled()
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })

  it('404s a call that belongs to another org — never a 403', async () => {
    // The row exists, but not in this org: the id+orgId where clause finds
    // nothing, so the caller cannot even learn the call is real.
    prismaMock.call.findFirst.mockResolvedValue(null)

    const res = await request(app).delete(`${URL_A}/call-in-org-b`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Call not found')
    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({
      where: { id: 'call-in-org-b', orgId: ORG_A },
    })
    expect(hangUpCallMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE /:id — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('DELETE /api/orgs/:orgId/calls/:id — org isolation', () => {
  it('401s without auth, and reads nothing', async () => {
    const res = await request(app).delete(`${URL_A}/call-1`)

    expect(res.status).toBe(401)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(hangUpCallMock).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it reads any call', async () => {
    authAs(null)

    const res = await request(app)
      .delete(`/api/orgs/${ORG_B}/calls/call-1`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
    expect(hangUpCallMock).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled, rather than admitting it exists', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).delete(`${URL_A}/call-1`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled()
  })
})
