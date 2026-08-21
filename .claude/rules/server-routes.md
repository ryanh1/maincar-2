---
paths:
  - "server/src/**"
---

# Server routes, logging

> Split out of the always-loaded CLAUDE.md so it loads only when
> you touch matching files. Same authority as CLAUDE.md. Do not duplicate it back.

## Server route patterns

- **Wrap every handler** in `wrapRoute()` from `server/src/lib/fnWrapper.ts`. It logs `route`, `userId`,
  `orgId` and handles errors consistently. Name routes `"GET /api/things"`.
- **Keyed JSON always** — `{ thing: … }`, `{ things: [...], total, page, limit }`,
  `{ error: "…" }`. Never a bare object, never a generic `data` key.
- **All external webhooks verify signatures** in middleware before the handler.
- **Long handlers carry section comments**, in this order, so every route reads the
  same way: `// --- Parse & validate params ---`, `// --- Build filters ---`,
  `// --- Verify ownership ---`, `// --- Execute query ---`,
  `// --- Return response ---`. Skip the ones a handler does not need.

## Logging (server)

- **Use the shared `logger` (pino), never `console.*`.**
  `logger.info({ orgId, userId }, "message")` — structured context in the
  object, human summary as the string. **Never log secrets, tokens, bodies, or PII.**
