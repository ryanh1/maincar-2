---
paths:
  - "server/src/**"
  - "vite/src/**"
---

# HTTP, third-party SDKs, and config

> Moved out of the always-loaded CLAUDE.md (ticket T-0-033) so it loads only when you
> touch application code. Same authority as CLAUDE.md. Do not duplicate it back.

## HTTP

- Prefer `fetch` over `axios`. Don't add `axios` without a hard requirement.

## Third-party APIs / SDKs

- Wrap every third-party SDK in a dedicated module under **`server/src/dependencies/`**
  (client-side: `vite/src/dependencies/`) and import from there — `twilio.ts`,
  `firebaseAdmin.ts`, `s3.ts`, `pgboss.ts`. One file per provider, named after the
  provider. Never construct an SDK client inline in a route or component.
- Keys, base URLs, default headers, and client construction live **inside** those
  modules, so swapping a provider touches one file.

## Environment variables & config

- **One config module reads all env** — `server/src/config.ts` on the server,
  `vite/src/config.ts` in the SPA. The server reads `process.env`; the SPA reads
  `import.meta.env` and only `VITE_`-prefixed public values. Never touch either
  outside those two files. Server-only secrets never reach the client bundle.
- **No fallbacks for required vars.** Use `!`, not `?? ""`. Missing env fails fast at
  startup rather than running degraded.
- `APP_NAME` ("Maincar") is a constant in config — never an env var, never a literal
  in a component.
