import pino from 'pino'

import { ENVIRONMENT, IS_LOCAL, LOG_LEVEL } from '../src/config.js'

// The shared logger. NEVER use console.log / console.warn / console.error in
// server code (CLAUDE.md → Server-side Logging).
//
// Call it as `logger.info({ ...fields }, "message")`: structured context in the
// first argument, a human-readable summary in the second.

const BASE_FIELDS = { environment: ENVIRONMENT, service: 'server' }

/**
 * A bounded error serializer.
 *
 * pino's default `err` serializer copies EVERY enumerable own property of the
 * error. For an HTTP or SDK error that means whole nested objects — response
 * headers, request bodies, response payloads. Anything shipping these logs to a
 * structured store flattens each nested leaf into a permanent field, which is how
 * a dataset's field count explodes.
 *
 * So: message and stack are always kept (failures stay debuggable), plus a short
 * allowlist of scalar diagnostics. Nested objects are never expanded.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: typeof err === 'string' ? err : JSON.stringify(err) }
  }
  const e = err as Error & Record<string, unknown>
  const out: Record<string, unknown> = {
    type: e.name,
    message: e.message,
    stack: e.stack,
  }
  for (const key of ['statusCode', 'status', 'code', 'isRetryable', 'url']) {
    const v = e[key]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v
    }
  }
  return out
}

function createLogger(): pino.Logger {
  return pino({
    level: LOG_LEVEL,
    base: BASE_FIELDS,
    // Both key names get the bounded serializer, so no call site can leak a full
    // SDK error object regardless of which one it used.
    serializers: { err: serializeError, error: serializeError },
    // Pretty and colorized locally; structured JSON on stdout everywhere else,
    // where a log shipper is reading it.
    ...(IS_LOCAL
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  })
}

export const logger = createLogger()
