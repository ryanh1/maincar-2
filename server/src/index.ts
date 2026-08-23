import { logger } from '../dependencies/logger.js'
import { initErrorReporter } from '../dependencies/errorReporter.js'
import app from './app.js'
import { APP_NAME, PORT } from './config.js'
import { registerProvisionNumberWorker } from './jobs/provisionNumber.js'
import { registerReleaseNumberWorker } from './jobs/releaseNumber.js'
import { registerCallerNameReconciliationWorker } from './jobs/reconcileCallerName.js'
import { registerUploadRecordingWorker } from './jobs/uploadRecording.js'
import { registerTranscribeRecordingWorker } from './jobs/transcribeRecording.js'
import { registerReapStaleCallsWorker, scheduleReapStaleCalls } from './jobs/reapStaleCalls.js'
import { registerDialerAnalyticsRollupWorker, scheduleDialerAnalyticsRollup } from './jobs/dialerAnalyticsRollup.js'
import { registerUploadVoicemailWorker } from './jobs/uploadVoicemail.js'
import { registerTranscribeVoicemailWorker } from './jobs/transcribeVoicemail.js'
import { registerTranscribeVoicemailDropWorker } from './jobs/transcribeVoicemailDrop.js'
import { registerTranscodeGreetingWorker } from './jobs/transcodeGreeting.js'
import { registerTranscodeVoicemailDropWorker } from './jobs/transcodeVoicemailDrop.js'
import { registerMailSyncWorker, scheduleMailSync } from './jobs/mailSync.js'
import { registerMailBackfillWorker } from './jobs/mailBackfill.js'
import { registerMailRematchWorker } from './jobs/mailRematch.js'
import { registerCapturePurgeWorker } from './jobs/capturePurge.js'
import { registerMailPushSubscriptionWorker, scheduleMailPushSubscriptions } from './jobs/mailPushSubscriptions.js'
import { registerCallWebPushWorker } from './jobs/callWebPush.js'
import { startQueue, stopQueue } from './jobs/queue.js'
import { registerOAuthTokenRefresher } from './lib/mail/oauthProviders.js'

initErrorReporter()

// Wire the real Google/Microsoft refresh into oauthConnections at startup. This is
// the seam int-schema (MAI-101) left open: withFreshAccessToken() refuses to run
// until a refresher is registered, and this is the one production caller. It lives
// here, not in app.ts, so the unit suite never reaches a provider through it.
registerOAuthTokenRefresher()

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
  await registerReleaseNumberWorker()
  await registerCallerNameReconciliationWorker()
  await registerUploadRecordingWorker()
  await registerTranscribeRecordingWorker()
  await registerReapStaleCallsWorker()
  await scheduleReapStaleCalls()
  await registerDialerAnalyticsRollupWorker()
  await scheduleDialerAnalyticsRollup()
  await registerUploadVoicemailWorker()
  await registerTranscribeVoicemailWorker()
  await registerTranscribeVoicemailDropWorker()
  await registerTranscodeGreetingWorker()
  await registerTranscodeVoicemailDropWorker()
  await registerMailSyncWorker()
  await registerCapturePurgeWorker()
  await scheduleMailSync()
  await registerMailBackfillWorker()
  await registerMailRematchWorker()
  await registerMailPushSubscriptionWorker()
  await registerCallWebPushWorker()
  await scheduleMailPushSubscriptions()
  logger.info(
    {
      workers: [
        'provision-number',
        'release-number',
        'reconcile-caller-name',
        'upload-recording',
        'transcribe-recording',
        'reap-stale-calls',
        'dialer-analytics-rollup',
        'upload-voicemail',
        'transcribe-voicemail',
        'transcribe-voicemail-drop',
        'transcode-greeting',
        'transcode-voicemail-drop',
        'mail-sync',
        'mail-backfill',
        'mail-rematch',
        'capture-purge',
        'mail-push-subscription',
      ],
    },
    'job queue workers started',
  )
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
