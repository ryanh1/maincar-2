// Unit tests, not route tests, on purpose.
//
// The limiter's buckets are per-process and keyed by IP, so driving it over
// supertest would spend the same 30-request budget the invitation route tests
// rely on, and adding a test there later would silently start 429ing another
// one. Calling the middleware directly keeps each case isolated.
import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'

vi.mock('../../../dependencies/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { rateLimit } from '../rateLimit.js'

function call(middleware: ReturnType<typeof rateLimit>, ip = '10.0.0.1') {
  const json = vi.fn()
  const setHeader = vi.fn()
  const res = { status: vi.fn().mockReturnThis(), json, setHeader } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  middleware({ ip } as Request, res, next)
  return { res, next, json, setHeader }
}

describe('rateLimit', () => {
  it('lets the first `max` requests through', () => {
    const middleware = rateLimit({ max: 3, name: 'test' })

    for (let i = 0; i < 3; i++) {
      const { next } = call(middleware)
      expect(next).toHaveBeenCalled()
    }
  })

  it('429s the request after `max`', () => {
    const middleware = rateLimit({ max: 3, name: 'test' })
    for (let i = 0; i < 3; i++) call(middleware)

    const { res, next, json, setHeader } = call(middleware)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(429)
    expect(json).toHaveBeenCalledWith({ error: 'Too many attempts. Wait a minute and try again.' })
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60')
  })

  // One noisy scanner must not lock everyone else out.
  it('counts each IP separately', () => {
    const middleware = rateLimit({ max: 2, name: 'test' })
    call(middleware, '10.0.0.1')
    call(middleware, '10.0.0.1')
    call(middleware, '10.0.0.1')

    const { next } = call(middleware, '10.0.0.2')

    expect(next).toHaveBeenCalled()
  })

  it('opens the window again after it expires', () => {
    vi.useFakeTimers()
    try {
      const middleware = rateLimit({ max: 1, name: 'test' })
      call(middleware)
      expect(call(middleware).next).not.toHaveBeenCalled()

      vi.advanceTimersByTime(61_000)

      expect(call(middleware).next).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('can rate limit by a verified-user key instead of a shared IP', () => {
    const middleware = rateLimit({
      max: 1,
      name: 'test',
      key: (req) => (req as Request & { userId: string }).userId,
    })
    const requestFor = (userId: string) => ({ ip: '10.0.0.1', userId } as unknown as Request)
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as unknown as Response
    const next = vi.fn() as unknown as NextFunction

    middleware(requestFor('user-a'), res, next)
    middleware(requestFor('user-a'), res, next)
    middleware(requestFor('user-b'), res, next)

    expect(next).toHaveBeenCalledTimes(2)
    expect(res.status).toHaveBeenCalledTimes(1)
  })
})
