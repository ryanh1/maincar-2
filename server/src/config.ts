import path from 'node:path'
import { config as loadEnv } from 'dotenv'

// The ONE module that reads the environment. Never touch `process.env` anywhere
// else (CLAUDE.md → Environment Variables & Config).
//
// src/ (dev, via tsx) and dist/src/ (built) are both one level under server/, so
// the repo-root .env is two levels up in both cases.
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env') })

/**
 * A required var. Missing means the process refuses to start, naming the var.
 * No `??` fallbacks for anything required — a silent default is how a server ends
 * up talking to the wrong database and nobody notices for a day.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`)
  }
  return value
}

// App identity is a product constant, never an env var.
export const APP_NAME = 'Maincar'

// --- App ---
export const PORT = Number(process.env.API_PORT) || 3010
export const ENVIRONMENT = process.env.NODE_ENV ?? 'development'
export const IS_LOCAL = ENVIRONMENT === 'development'
export const LOG_LEVEL = process.env.LOG_LEVEL ?? (IS_LOCAL ? 'debug' : 'info')

// --- URLs ---
// The browser origin allowed through CORS. Must match the Vite dev server's port
// exactly, which is why that port is `strictPort`.
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5183'
// The public URL this API is reachable on from the internet (the zrok tunnel).
// Every externally-facing callback URL is built from it, so the host is never
// hardcoded anywhere else.
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')

// --- Database ---
export const DATABASE_URL = required('DATABASE_URL')
// The direct (non-pooled) URL migrations use. Optional locally, where there is no
// connection pooler in front of Postgres.
export const DIRECT_DATABASE_URL = process.env.DIRECT_DATABASE_URL

// --- Token encryption (OAuth refresh tokens) ---
// The master key for AES-256-GCM at-rest encryption of OAuth grants, consumed
// ONLY by server/src/lib/tokenCrypto.ts. It is supplied as base64 for 32 raw
// bytes (an AES-256 key): `openssl rand -base64 32`. This is the single place the
// key is read — no fallback, `required()` fails fast at startup with a named
// error rather than a stack trace at first decrypt. A missing or wrong-length key
// takes the process down here, on purpose. Rotation stays additive: a `v2`
// ciphertext format would introduce a second key beside this one, never a
// migration of stored rows, so this remains one required value.
export const TOKEN_ENC_KEY: Buffer = decodeTokenEncKey(required('TOKEN_ENC_KEY'))

function decodeTokenEncKey(raw: string): Buffer {
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENC_KEY must decode to 32 bytes for AES-256; got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    )
  }
  return key
}

// --- OAuth signed state (CSRF for the consent round-trip) ---
// The HMAC-SHA256 key that signs the stateless `state` carried through the OAuth
// redirect (server/src/lib/oauthState.ts). It is deliberately NOT the token
// encryption key: two independent secrets, so rotating one never touches the
// other. This is the single place it is read. A short key is a weak MAC — the
// process refuses to start under 32 characters rather than sign with it, on
// purpose, here at startup rather than at the first callback.
export const OAUTH_STATE_SECRET = requireMinLength('OAUTH_STATE_SECRET', 32)

/** A required var that also enforces a minimum length, failing fast when short. */
function requireMinLength(name: string, min: number): string {
  const value = required(name)
  if (value.length < min) {
    throw new Error(`${name} must be at least ${min} characters; got ${value.length}.`)
  }
  return value
}

// --- OAuth provider clients (Google + Microsoft) ---
// The one shared OAuth app per provider (CAPABILITY-MAP-INTEGRATIONS.md assumption
// 1: one app for all orgs, not per-org credentials). The client id and secret are
// consumed ONLY inside server/dependencies/googleOAuth.ts and microsoftOAuth.ts —
// this is the single place they are read from the environment. `required()` is the
// `!`-with-no-fallback rule: a missing credential takes the process down here at
// startup, naming the var, rather than surfacing as an opaque 401 at the first
// consent. Real values are provisioned in the Google Cloud and Entra consoles;
// until then the server still boots against placeholders and only a live consent
// fails.
export const GOOGLE_OAUTH_CLIENT_ID = required('GOOGLE_OAUTH_CLIENT_ID')
export const GOOGLE_OAUTH_CLIENT_SECRET = required('GOOGLE_OAUTH_CLIENT_SECRET')
export const MS_OAUTH_CLIENT_ID = required('MS_OAUTH_CLIENT_ID')
export const MS_OAUTH_CLIENT_SECRET = required('MS_OAUTH_CLIENT_SECRET')

// The public origin the provider redirects back to after consent. Every provider's
// `redirect_uri` is built from it as `${OAUTH_REDIRECT_BASE}/api/integrations/
// :provider/callback`, so the callback host is never hardcoded in a client. It must
// match, character for character, a redirect URI registered on the OAuth app — a
// mismatch is the `redirect_uri_mismatch` error. Trailing slashes are trimmed so
// the joined path never doubles one.
export const OAUTH_REDIRECT_BASE = required('OAUTH_REDIRECT_BASE').replace(/\/+$/, '')

// --- Firebase Admin ---
// Verifies the ID token on every authenticated request. In local dev the emulator
// host is set instead, and the SDK picks it up automatically.
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? ''
export const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL ?? ''
// .env stores the key with escaped newlines; restore real ones for the SDK.
export const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
export const FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? ''

// --- S3 / MinIO (local dev = MinIO, production = real S3) ---
export const S3_ENDPOINT = process.env.S3_ENDPOINT ?? ''
export const S3_REGION = process.env.S3_REGION ?? 'us-east-1'
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? ''
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? ''
export const S3_BUCKET = process.env.S3_BUCKET ?? ''

// --- Twilio ---
// Deliberately NOT required(): `/api/health` and the whole unit suite have to
// boot on a machine with no Twilio account, and required() would take the
// process down at import. dependencies/twilio.ts throws a named error when a
// route actually calls Twilio instead, so a missing credential fails the one
// request that needed it rather than the server.
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? ''
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? ''
// A Twilio API Key (not the account auth token) is what signs a browser Voice SDK
// access token, and TWILIO_TWIML_APP_SID is the Application the token grants the
// rep's browser permission to call out through (dependencies/twilio.ts →
// mintVoiceAccessToken). Same "?? ''" reasoning as the pair above: a machine with
// no Twilio account still has to boot.
export const TWILIO_API_KEY_SID = process.env.TWILIO_API_KEY_SID ?? ''
export const TWILIO_API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET ?? ''
export const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID ?? ''

// --- OpenAI (call transcription) ---
// Consumed ONLY inside server/dependencies/openai.ts, which turns a call
// recording into text (jobs/transcribeRecording.ts). Read as `?? ''` rather than
// required(), for the same reason Twilio and S3 are: `/api/health` and the whole
// unit suite must boot on a machine with no OpenAI account, and required() would
// take the process down at import. dependencies/openai.ts throws a named error at
// call time when the key is missing, so a missing credential fails the one job
// that needed it rather than the server.
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''

// --- Outbound calling ---
// A user can queue three browser-originated calls per minute by default. This is
// configurable for an environment that needs a different operational ceiling,
// but invalid values fail closed at startup rather than silently disabling it.
function optionalPositiveInteger(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultValue

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer; got ${JSON.stringify(raw)}.`)
  }
  return value
}

export const CALL_CREATION_RATE_LIMIT = optionalPositiveInteger('CALL_CREATION_RATE_LIMIT', 3)
