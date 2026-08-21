import type { NextFunction, Request, Response } from 'express'

import { logger } from '../../dependencies/logger.js'

/**
 * A small fixed-window limiter for the invite-token routes.
 *
 * Those two routes are the only ones a stranger can call with a guessable value
 * in the path, so they are the only ones that need this. Everything else is
 * behind `requireAuth`, where the Firebase token is the throttle.
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

export function rateLimit(options: { max: number; name: string }) {
  const buckets = new Map<string, Bucket>()

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now()

    // Sweep expired buckets on the way through, so an IP that called once a year
    // ago is not still holding a map entry.
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }

    const key = req.ip ?? 'unknown'
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
      res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' })
      return
    }

    next()
  }
}
