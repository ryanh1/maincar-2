import type { NextFunction, Request, Response } from 'express'

import { logger } from '../../dependencies/logger.js'

/**
 * A small fixed-window limiter for public invite-token routes and authenticated
 * call creation.
 *
 * Those two routes are the only ones a stranger can call with a guessable value
 * in the path, so they need an IP-based limit. Call creation uses the same
 * implementation with a verified-user key, so reps sharing an IP do not consume
 * one another's call budget.
 *
 * In memory, and therefore PER PROCESS: two instances behind a load balancer
 * each allow the limit. That is a deliberate trade — the alternative is a Redis
 * dependency for one route pair. A 256-bit token is not brute-forceable at any
 * rate this would let through; the limit is here to stop a noisy scanner, not to
 * be the security boundary.
 */
interface Bucket {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000

export interface RateLimitOptions {
  /** Maximum requests each key may make during one fixed window. */
  max: number
  /** Route label for logs; never use an untrusted URL here. */
  name: string
  /**
   * Identifies the caller to limit. Defaults to the remote IP for public routes;
   * authenticated routes can pass a verified user id instead.
   */
  key?: (req: Request) => string
  /** Formats the client-safe 429 message from the remaining retry delay. */
  message?: (retryAfterSeconds: number) => string
}

export type RateLimitMiddleware = ((req: Request, res: Response, next: NextFunction) => void) & {
  reset: () => void
}

export function rateLimit(options: RateLimitOptions): RateLimitMiddleware {
  const buckets = new Map<string, Bucket>()

  const middleware = function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now()

    // Sweep expired buckets on the way through, so an IP that called once a year
    // ago is not still holding a map entry.
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }

    const key = options.key?.(req) ?? req.ip ?? 'unknown'
    const bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
      return next()
    }

    bucket.count += 1
    if (bucket.count > options.max) {
      // The route name, never the path: the path carries the invite token
      // (MAI-7 → "No token appears in any log line or logged URL").
      logger.warn({ route: options.name }, 'rate limit hit')
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      res.status(429).json({
        error: options.message?.(retryAfterSeconds) ?? 'Too many attempts. Wait a minute and try again.',
      })
      return
    }

    next()
  }

  // Route-test processes share module state across examples. Let focused route
  // tests reset this in-memory implementation without weakening production
  // behavior or needing an actual Redis service in unit tests.
  middleware.reset = () => buckets.clear()
  return middleware
}
