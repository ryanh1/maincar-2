import type { Request, Response } from 'express'

import { logger } from '../../dependencies/logger.js'
import { captureException } from '../../dependencies/errorReporter.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

/**
 * Is this a "the database is not reachable" error, as opposed to a bug?
 *
 * It matters because the two deserve different status codes: 503 tells a client
 * to retry, 500 does not.
 */
function isDbUnavailableError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown }
  const code = err?.code
  const message = typeof err?.message === 'string' ? err.message : ''
  return (
    code === 'ECONNREFUSED' ||
    code === 'P1000' ||
    code === 'P1001' ||
    message.includes('ECONNREFUSED') ||
    message.includes("Can't reach database server") ||
    message.includes('Connection refused')
  )
}

type RouteHandler = (req: Request, res: Response) => Promise<void>

/**
 * Wraps an Express handler with the logging and error handling every route needs.
 *
 *   router.get("/:id", requireAuth, wrapRoute("GET /api/things/:id", async (req, res) => { ... }))
 *
 * Routes NEVER write their own try/catch (CLAUDE.md → Server Route Patterns).
 * The wrapper logs the route name plus userId, orgId and requestId on every call,
 * and on a throw it logs, reports, and answers 503 (database down) or 500.
 *
 * Pass `{ quiet: true }` for a high-frequency polling endpoint: the per-request
 * "called" line drops to `debug` so it does not flood the logs. Errors are always
 * logged at `error`.
 */
export function wrapRoute(name: string, handler: RouteHandler, opts: { quiet?: boolean } = {}) {
  return async (req: Request, res: Response): Promise<void> => {
    const authReq = req as unknown as AuthenticatedRequest
    const userId = authReq.user?.id ?? 'anon'
    const currentOrgId = authReq.user?.currentOrgId ?? 'none'
    const requestId = req.id
    const fields = { route: name, requestId, userId, currentOrgId }

    if (opts.quiet) logger.debug(fields, `${name} called`)
    else logger.info(fields, `${name} called`)

    try {
      await handler(req, res)
    } catch (error) {
      logger.error({ ...fields, error }, `${name} failed`)
      captureException(error, fields)

      if (isDbUnavailableError(error)) {
        res.status(503).json({ error: 'Database unavailable' })
        return
      }
      // The real message is never sent to the client: a stack trace is not
      // something a user can act on, and it leaks internals.
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
