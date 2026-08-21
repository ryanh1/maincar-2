// Global setup for the UNIT suite. It runs before any test module — and
// therefore before config.ts reads the environment — so the values set here win.
// dotenv does not override a var that is already set.
//
// Nothing is mocked here. Mocking the database is per-file, with vi.hoisted() +
// vi.mock("../../db.js") ahead of `import app`, so a test that wants the real
// thing simply does not do it.

// A test must never depend on the developer's local database.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5440/maincar2_unit_never_used'

// A fixed 32-byte (base64) key so config.ts boots and tokenCrypto round-trips
// deterministically. Set here rather than read from .env so the suite never
// depends on a developer's local secrets.
process.env.TOKEN_ENC_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

// A fixed ≥32-char HMAC key so config.ts boots and oauthState signs/verifies
// deterministically. Set here rather than read from .env so the suite never
// depends on a developer's local secrets. oauthState.test.ts reads this exact
// value back to forge validly-signed-but-malformed payloads.
process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-0123456789abcdef'

// Keep log output out of the test report, and make it deterministic.
process.env.LOG_LEVEL = 'silent'
process.env.NODE_ENV = 'test'

// The Firebase Admin SDK must never reach a real project from a test. Every test
// file mocks `dependencies/firebaseAdmin.js`; this is the belt to that braces.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9140'
process.env.FIREBASE_PROJECT_ID = 'maincar-2-test'
