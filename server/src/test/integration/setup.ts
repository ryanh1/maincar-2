// Per-worker setup for the INTEGRATION suite.
//
// Unlike the unit suite's src/test/setup.ts, this does NOT point DATABASE_URL at
// a dummy — the tests run against the real schema globalSetup created. It only
// applies the same "never reach the network" guards so a run stays deterministic.
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'

// A fixed 32-byte (base64) key so config.ts boots when a test imports the app.
// Set here so the integration suite does not depend on a developer's .env.
process.env.TOKEN_ENC_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

// A fixed ≥32-char HMAC key so config.ts boots when a test imports the app.
// Set here so the integration suite does not depend on a developer's .env.
process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-0123456789abcdef'

// Placeholder OAuth app credentials so config.ts boots when a test imports the app.
// No integration test reaches a provider; these only satisfy config.ts's required().
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com'
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret'
process.env.MS_OAUTH_CLIENT_ID = 'test-microsoft-client-id'
process.env.MS_OAUTH_CLIENT_SECRET = 'test-microsoft-client-secret'
process.env.OAUTH_REDIRECT_BASE = 'https://test.example.com'

// Never let the Firebase Admin SDK reach a real project from a test.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9140'
process.env.FIREBASE_PROJECT_ID = 'maincar-2-test'
