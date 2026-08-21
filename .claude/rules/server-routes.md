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

## Org-scoped writes (review checklist)

Every write to an org-scoped model — `Membership`, `Invitation`, `PhoneNumber`,
`Call`, `EmailDraft` — goes through this list before it merges. The first two are
enforced by `G-STRUCT` in `server/src/routes/__tests__/guardrails.test.ts`; the
rest are a reviewer's job.

- **`updateMany` / `deleteMany`, never `update` / `delete` by id.** The `where`
  clause is where the tenant boundary lives. `update({ where: { id } })` has
  nowhere to put `orgId`, so a guessed id writes another org's row.
- **Every such `where` carries `orgId`** (plus `isActive` for memberships), and
  the result's `count === 0` answers **404** — never a silent success.
- **A count-then-write guardrail lives inside ONE transaction**, and the count
  takes a row lock (`SELECT … FOR UPDATE`). A plain count outside a transaction
  lets two concurrent requests both read the safe number and both commit.
- **The org id comes from the verified path**, never from the request body.
- **A caller outside the org gets 404, not 403.** 403 confirms the org exists.

The guardrails these protect are the matrix in
`server/src/routes/__tests__/guardrails.test.ts` and its integration twin. A new
rule is one row there.

## Logging (server)

- **Use the shared `logger` (pino), never `console.*`.**
  `logger.info({ orgId, userId }, "message")` — structured context in the
  object, human summary as the string. **Never log secrets, tokens, bodies, or PII.**
