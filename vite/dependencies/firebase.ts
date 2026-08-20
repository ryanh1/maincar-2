// Firebase SDK construction lives HERE and nowhere else.
//
// House rule (CLAUDE.md → Third-party APIs / SDKs): every third-party SDK is
// initialized in one dedicated file under `vite/dependencies/`, reading its keys
// from `@/config`. Application code imports the wrapper, never the SDK.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'

import { FIREBASE_CONFIG_JSON, FIREBASE_USE_EMULATORS } from '@/config'

let app: FirebaseApp | null = null
let auth: Auth | null = null

export function getFirebaseApp(): FirebaseApp {
  if (app) return app
  const config = JSON.parse(FIREBASE_CONFIG_JSON) as Record<string, unknown>
  app = initializeApp(config)
  return app
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth
  auth = getAuth(getFirebaseApp())
  if (FIREBASE_USE_EMULATORS) {
    // Routed through the app's own origin so an HTTPS tunnel stays mixed-content
    // safe. Vite proxies the emulator paths in dev (see vite.config.ts).
    connectAuthEmulator(auth, window.location.origin, { disableWarnings: true })
  }
  return auth
}
