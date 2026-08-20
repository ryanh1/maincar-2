import { logger } from './logger.js'

/**
 * The seam where an error-reporting service (Sentry, Rollbar, …) plugs in.
 *
 * It is deliberately a no-op beyond logging right now, so `wrapRoute` can call
 * `captureException` unconditionally and adding a real reporter later is a change
 * to THIS file only — not to every route.
 *
 * To wire Sentry up: install `@sentry/node`, call `Sentry.init` in `initErrorReporter`,
 * and forward to `Sentry.captureException` below.
 */
export function initErrorReporter(): void {
  // Nothing to start yet.
}

export function captureException(error: unknown, context: Record<string, unknown> = {}): void {
  logger.debug({ ...context, error }, 'captureException (no reporter configured)')
}
