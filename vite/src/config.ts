// The ONE module that reads the environment on the client.
//
// NEVER touch `import.meta.env` anywhere else (CLAUDE.md → Environment Variables
// & Config). Only VITE_-prefixed vars exist at runtime; everything else is
// stripped from the bundle.
//
// Required vars use `!` so a missing one fails fast and loudly. Optional vars
// that make a feature no-op may fall back to "".

// App identity is a product constant, never an env var. Import it — never write
// the literal string in a component.
export const APP_NAME = 'Maincar'
export const APP_SLOGAN = 'Your app slogan goes here'

export const API_URL = import.meta.env.VITE_API_URL || ''

// "local" | "staging" | "production". Drives emulator wiring and logging.
export const ENVIRONMENT = import.meta.env.VITE_ENVIRONMENT || 'local'

// The whole Firebase web config as one JSON blob, so adding a field never means
// adding another env var. Generate it from the Firebase console's config object.
export const FIREBASE_CONFIG_JSON = import.meta.env.VITE_FIREBASE_CONFIG!
export const FIREBASE_USE_EMULATORS = ENVIRONMENT === 'local'
export const FIREBASE_AUTH_EMULATOR_URL =
  import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9140'

export const IS_DEV = import.meta.env.DEV
export const API_LOGGING_ENABLED = import.meta.env.VITE_DISABLE_API_LOGGING !== 'true'
