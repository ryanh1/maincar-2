import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

// Make `req.id` typed everywhere.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string
    }
  }
}

/**
 * Gives every request a correlation id and echoes it back as `X-Request-Id`.
 *
 * An inbound `X-Request-Id` (from a proxy or an upstream service) is honored, so
 * one request can be followed across hops. `wrapRoute` puts the id into every log
 * line, which is what makes a single request's lines findable later.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id']
  const id = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim() || randomUUID()
  req.id = id
  res.setHeader('X-Request-Id', id)
  next()
}
