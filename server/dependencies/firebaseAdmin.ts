import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'

import {
  FIREBASE_AUTH_EMULATOR_HOST,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_PROJECT_ID,
} from '../src/config.js'

// Firebase Admin is constructed HERE and nowhere else
// (CLAUDE.md → Third-party APIs / SDKs). Route and service code calls the
// functions below; it never touches the SDK directly.

let app: App | null = null

function getAdminApp(): App {
  if (app) return app

  const existing = getApps()[0]
  if (existing) {
    app = existing
    return app
  }

  // With FIREBASE_AUTH_EMULATOR_HOST set (local dev), the SDK talks to the
  // emulator and needs no service-account credentials at all — a project id is
  // enough. Passing a fake cert here would fail instead.
  if (FIREBASE_AUTH_EMULATOR_HOST) {
    app = initializeApp({ projectId: FIREBASE_PROJECT_ID || 'maincar-2' })
    return app
  }

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and ' +
        'FIREBASE_PRIVATE_KEY, or set FIREBASE_AUTH_EMULATOR_HOST for local development.',
    )
  }

  app = initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
    }),
  })
  return app
}

/** Verifies a Firebase ID token. Throws when it is invalid, expired, or forged. */
export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  return getAuth(getAdminApp()).verifyIdToken(idToken)
}

/** Blocks or restores sign-in for an account without deleting it. */
export async function setFirebaseUserDisabled(uid: string, disabled: boolean): Promise<void> {
  await getAuth(getAdminApp()).updateUser(uid, { disabled })
}

export async function deleteFirebaseUser(uid: string): Promise<void> {
  await getAuth(getAdminApp()).deleteUser(uid)
}
