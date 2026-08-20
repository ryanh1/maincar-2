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
