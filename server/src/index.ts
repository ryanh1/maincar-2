import { logger } from '../dependencies/logger.js'
import { initErrorReporter } from '../dependencies/errorReporter.js'
import app from './app.js'
import { APP_NAME, PORT } from './config.js'
import { registerProvisionNumberWorker } from './jobs/provisionNumber.js'
import { startQueue, stopQueue } from './jobs/queue.js'

initErrorReporter()

// An unhandled rejection kills the process silently by default. Log it first, so
// a crash is never a mystery.
process.on('unhandledRejection', (reason) => {
  logger.error({ error: reason }, 'unhandled promise rejection')
})
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'uncaught exception')
  process.exit(1)
})

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, `[${APP_NAME.toLowerCase()}] listening on http://localhost:${PORT}`)
})

// The queue worker starts HERE, and never in app.ts.
//
// app.ts is imported by every supertest file in the unit suite. Anything it can
// reach transitively would open a real pg-boss connection — and run pg-boss's
// schema migration — on every test run.
async function startWorkers(): Promise<void> {
  await startQueue()
  await registerProvisionNumberWorker()
  logger.info({ worker: 'provision-number' }, 'job queue workers started')
}

// Deliberately not fatal: the HTTP API still serves requests with the queue down,
// and jobs stay queued in Postgres until a worker comes back.
void startWorkers().catch((error) => {
  logger.error({ error }, 'job queue failed to start; background jobs will not run')
})

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down')
  // Queue first, gracefully: a job that is mid-Twilio-purchase gets to finish and
  // write its row rather than being cut off after the money was spent.
  try {
    await stopQueue()
  } catch (error) {
    logger.error({ error }, 'job queue did not stop cleanly')
  }
  server.close(() => process.exit(0))
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}
