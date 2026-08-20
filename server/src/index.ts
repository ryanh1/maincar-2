import { logger } from '../dependencies/logger.js'
import { initErrorReporter } from '../dependencies/errorReporter.js'
import app from './app.js'
import { APP_NAME, PORT } from './config.js'

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

app.listen(PORT, () => {
  logger.info({ port: PORT }, `[${APP_NAME.toLowerCase()}] listening on http://localhost:${PORT}`)
})
