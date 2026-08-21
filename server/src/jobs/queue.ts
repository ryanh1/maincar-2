import { PgBoss, type JobWithMetadata, type SendOptions, type WorkOptions } from 'pg-boss'

import { logger } from '../../dependencies/logger.js'
import { DATABASE_URL } from '../config.js'

// The pg-boss SDK is constructed HERE and nowhere else. Job code calls the
// functions below; it never touches a PgBoss instance, never sees an SDK shape,
// and never learns the connection string.
//
// Everything a test needs is behind this module's exports on purpose: a unit test
// `vi.mock`s this file and gets a queue-free handler, instead of standing up a
// real Postgres-backed worker to assert on one Prisma write.

// --- Job names ---
//
// Names are constants, not loose strings. A typo in `send("provision-numbers")`
// is a job that enqueues successfully and is never picked up by any worker —
// silent, and only visible as "the number never activated". A typo in
// JOB_PROVISION_NUMBER is a compile error.

export const JOB_PROVISION_NUMBER = 'provision-number'

export const JOB_RELEASE_NUMBER = 'release-number'

export const JOB_UPLOAD_RECORDING = 'upload-recording'

export const JOB_TRANSCRIBE_RECORDING = 'transcribe-recording'

export const JOB_REAP_STALE_CALLS = 'reap-stale-calls'

export const JOB_NAMES = [
  JOB_PROVISION_NUMBER,
  JOB_RELEASE_NUMBER,
  JOB_UPLOAD_RECORDING,
  JOB_TRANSCRIBE_RECORDING,
  JOB_REAP_STALE_CALLS,
] as const

export type JobName = (typeof JOB_NAMES)[number]

/**
 * Queue-level defaults, applied when the queue is created.
 *
 * Every job in a queue inherits these unless the individual `send` overrides
 * them. They are set here so a queue behaves the same no matter which caller
 * enqueued the job.
 */
const QUEUE_DEFAULTS: Record<JobName, { retryLimit: number; retryDelay: number }> = {
  // One retry, thirty seconds later. See jobs/provisionNumber.ts for why this
  // queue must not retry more than that: the work it does spends money.
  [JOB_PROVISION_NUMBER]: { retryLimit: 1, retryDelay: 30 },
  // Three retries, a minute apart — deliberately more generous than its buying
  // twin above. The asymmetry is the point: a retry that fails to BUY costs
  // nothing, while a retry that fails to RELEASE leaves the org renting a number
  // it has already given up. See jobs/releaseNumber.ts.
  [JOB_RELEASE_NUMBER]: { retryLimit: 3, retryDelay: 60 },
  // One retry, thirty seconds later — long enough for a Twilio or S3 blip to
  // pass. See jobs/uploadRecording.ts: a second retry buys nothing a first does
  // not, and the recording is safe on Twilio until the upload finally succeeds.
  [JOB_UPLOAD_RECORDING]: { retryLimit: 1, retryDelay: 30 },
  // One retry, thirty seconds later. See jobs/transcribeRecording.ts: a Whisper
  // call is expensive enough that hammering it on a persistent failure buys
  // nothing, so a single retry then a `failed` transcriptStatus is the ceiling.
  [JOB_TRANSCRIBE_RECORDING]: { retryLimit: 1, retryDelay: 30 },
  // No retry. This is a scheduled sweep (see scheduleJob below), re-run every 15
  // minutes regardless — a failed run is caught by the next tick, and retrying
  // immediately would just repeat the same Twilio/database failure sooner.
  [JOB_REAP_STALE_CALLS]: { retryLimit: 0, retryDelay: 0 },
}

let boss: PgBoss | null = null
// The in-flight start, so two concurrent callers share one instance instead of
// racing to build two connection pools against the same database.
let starting: Promise<PgBoss> | null = null

/**
 * The shared queue, started on first use.
 *
 * Lazy, like the Twilio client, and for the same reason: importing this module
 * must not open a database connection. `app.ts` is pulled into every supertest
 * file in the unit suite, so anything it can reach transitively has to stay inert
 * until something actually calls it.
 *
 * pg-boss runs on the same Postgres as Prisma, in its own `pgboss` schema, and
 * installs/migrates that schema itself on `start()`.
 */
export async function startQueue(): Promise<PgBoss> {
  if (boss) return boss
  if (starting) return starting

  starting = (async () => {
    const instance = new PgBoss({ connectionString: DATABASE_URL, schema: 'pgboss' })

    // pg-boss emits `error` rather than throwing for background failures
    // (maintenance, the polling loop). Node turns an unhandled 'error' event on
    // an EventEmitter into a process crash, so this listener is not optional.
    instance.on('error', (error) => {
      logger.error({ error }, 'job queue error')
    })

    await instance.start()

    // Queues must exist before anything can send to them or work them. This is
    // ON CONFLICT DO NOTHING inside pg-boss, so it is safe on every boot.
    for (const name of JOB_NAMES) {
      await instance.createQueue(name, QUEUE_DEFAULTS[name])
    }

    boss = instance
    return instance
  })()

  try {
    return await starting
  } finally {
    starting = null
  }
}

/** Stop the queue and release its connections. Safe to call when nothing started. */
export async function stopQueue(): Promise<void> {
  if (!boss) return
  const instance = boss
  boss = null
  // Graceful: a job that is mid-Twilio-call gets to finish rather than being
  // killed halfway through a purchase.
  await instance.stop({ graceful: true, close: true })
}

/**
 * Enqueue one job. Returns pg-boss's job id, or null when pg-boss dropped it as
 * a duplicate (singleton keys, debounce) — never a thrown error for that case.
 */
export async function sendJob(
  name: JobName,
  data: object,
  options: SendOptions = {},
): Promise<string | null> {
  const instance = await startQueue()
  return instance.send(name, data, options)
}

/**
 * Put one job on a recurring cron schedule instead of enqueuing it once.
 *
 * pg-boss owns the timekeeping — this just tells it to send `name` on `cron`
 * from now on, deduping so a restart does not stack up duplicate schedules.
 * Idempotent to call on every boot, exactly like `createQueue` above.
 */
export async function scheduleJob(
  name: JobName,
  cron: string,
  data: object | null = null,
): Promise<void> {
  const instance = await startQueue()
  await instance.schedule(name, cron, data)
}

/**
 * Register a worker for one job name.
 *
 * pg-boss hands the handler a BATCH of jobs; this unwraps it to one job at a
 * time, because every job here settles independently and a shared throw would
 * fail siblings that had already succeeded.
 *
 * `includeMetadata` is forced on: a handler cannot decide whether it is on its
 * last attempt without `retryCount` and `retryLimit`.
 */
export async function workJob<T extends object>(
  name: JobName,
  options: Omit<WorkOptions, 'includeMetadata'>,
  handler: (job: JobWithMetadata<T>) => Promise<void>,
): Promise<string> {
  const instance = await startQueue()
  // Annotated rather than inline: pg-boss picks the handler's shape off the
  // options TYPE, so `includeMetadata: true` has to survive as a literal for the
  // batch below to be typed as JobWithMetadata rather than bare Job.
  type MetadataWorkOptions = WorkOptions & { includeMetadata: true }
  const workOptions: MetadataWorkOptions = { ...options, includeMetadata: true }
  // All three type arguments are spelled out because naming even one of them
  // stops TypeScript inferring the rest, and the options type is what decides
  // whether the batch arrives as JobWithMetadata or as bare Job.
  return instance.work<T, void, MetadataWorkOptions>(name, workOptions, async (jobs) => {
    for (const job of jobs) {
      await handler(job)
    }
  })
}
