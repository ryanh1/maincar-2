// Unit tests, not route tests, on purpose: the branch under test is entirely
// inside the middleware, and calling it directly lets a Firebase transport
// failure be simulated without standing up a route or a database.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Response } from 'express'

const { prismaMock, verifyTokenMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn() } },
  verifyTokenMock: vi.fn(),
  loggerMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/logger.js', () => ({ logger: loggerMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

import { isTransportFailure, requireAuth, type AuthenticatedRequest } from '../auth.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@orga.com',
    firstName: 'Al',
    lastName: 'Pha',
    roles: ['basic'],
    enabled: true,
    currentOrgId: 'org-a',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** A `FirebaseAuthError` as the Admin SDK actually shapes one. */
function firebaseError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code: string; errorInfo: { code: string } }
  err.name = 'FirebaseAuthError'
  err.code = code
  err.errorInfo = { code }
  return err
}

async function call(authorization?: string) {
  const json = vi.fn()
  const setHeader = vi.fn()
  const res = { status: vi.fn().mockReturnThis(), json, setHeader } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  const req = {
    headers: authorization ? { authorization } : {},
  } as unknown as AuthenticatedRequest

  await requireAuth(req, res, next)
  return { req, res, next, json, setHeader }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireAuth — Firebase is unreachable', () => {
  // The exact error observed during an emulator outage, with a valid token.
  const outage = firebaseError(
    'app/network-error',
    'Error while making request: connect ECONNREFUSED 127.0.0.1:9140. Error code: ECONNREFUSED',
  )

  it('answers 503, not 401, so the caller keeps its session', async () => {
    verifyTokenMock.mockRejectedValue(outage)

    const { res, next, json, setHeader } = await call('Bearer good-token')

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({
      error: 'Cannot reach the sign-in service. Try again in a moment.',
    })
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '5')
  })

  it('never reaches the database', async () => {
    verifyTokenMock.mockRejectedValue(outage)

    await call('Bearer good-token')

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
  })

  it('logs the outage at error level, with the underlying code', async () => {
    verifyTokenMock.mockRejectedValue(outage)

    await call('Bearer good-token')

    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    const [fields, message] = loggerMock.error.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ]
    expect(fields.firebaseErrorCode).toBe('app/network-error')
    expect(fields.err).toBe(outage)
    expect(message).toContain('could not reach Firebase')
    // The token was fine. The log line must not send anyone hunting for a bad one.
    expect(message).not.toMatch(/invalid|expired|revoked|bad token|malformed/i)
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['a bare socket error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['a timeout', Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' })],
    ['DNS failure', Object.assign(new Error('getaddrinfo'), { code: 'EAI_AGAIN' })],
    ['an undici connect timeout', Object.assign(new Error('fetch failed'), { code: 'UND_ERR_CONNECT_TIMEOUT' })],
    ['a nested cause', Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('connect'), { code: 'ECONNRESET' }),
    })],
    ['a network timeout from the SDK', firebaseError('app/network-timeout', 'timed out')],
  ])('treats %s as a transport failure', async (_label, err) => {
    verifyTokenMock.mockRejectedValue(err)

    const { res } = await call('Bearer good-token')

    expect(res.status).toHaveBeenCalledWith(503)
  })
})

describe('requireAuth — the token itself is the problem', () => {
  it.each([
    ['expired', firebaseError('auth/id-token-expired', 'Firebase ID token has expired.')],
    ['revoked', firebaseError('auth/id-token-revoked', 'Firebase ID token has been revoked.')],
    ['malformed', firebaseError('auth/argument-error', 'Decoding Firebase ID token failed.')],
  ])('still answers 401 for a %s token', async (_label, err) => {
    verifyTokenMock.mockRejectedValue(err)

    const { res, next, json } = await call('Bearer bad-token')

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({ error: 'Not signed in' })
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it('answers 401 when there is no Authorization header', async () => {
    const { res, next, json } = await call()

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({ error: 'Not signed in' })
    expect(verifyTokenMock).not.toHaveBeenCalled()
  })

  it('answers 401 when the header is not a Bearer token', async () => {
    const { res, next } = await call('Basic abc123')

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  // An unrecognized failure must fail CLOSED. Guessing "outage" here would let a
  // forged token past the only gate that stops it.
  it('answers 401 for an unrecognized verification failure', async () => {
    verifyTokenMock.mockRejectedValue(new Error('something new'))

    const { res } = await call('Bearer whatever')

    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('answers 401 when the token is valid but no User row exists', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-a' })
    prismaMock.user.findUnique.mockResolvedValue(null)

    const { res, next, json } = await call('Bearer good-token')

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({ error: 'Not signed in' })
  })
})

describe('requireAuth — the happy path is unchanged', () => {
  it('attaches the user and calls next()', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-a' })
    prismaMock.user.findUnique.mockResolvedValue(userRow())

    const { req, next, res } = await call('Bearer good-token')

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(req.user).toMatchObject({ id: 'user-a', firebaseUid: 'uid-a', enabled: true })
  })

  it('still 403s a disabled account', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-a' })
    prismaMock.user.findUnique.mockResolvedValue(userRow({ enabled: false }))

    const { res, next } = await call('Bearer good-token')

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })
})

describe('isTransportFailure', () => {
  it('is false for a rejected token', () => {
    expect(isTransportFailure(firebaseError('auth/id-token-expired', 'expired'))).toBe(false)
  })

  it('is false for null and undefined', () => {
    expect(isTransportFailure(null)).toBe(false)
    expect(isTransportFailure(undefined)).toBe(false)
  })

  it('does not loop forever on a self-referencing cause', () => {
    const err = new Error('round') as Error & { cause?: unknown }
    err.cause = err
    expect(isTransportFailure(err)).toBe(false)
  })
})
