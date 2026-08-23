# Dependency advisory triage — 2026-08-23

Triage of the npm advisories reported by `npm audit` in the `server` and
`firebase` packages. Issue: MAI-433.

## Summary

| Package | Advisory | Severity | Reachability | Safe fix? |
| --- | --- | --- | --- | --- |
| `server` → `deepmerge-ts@7.1.5` | GHSA-ggr8-5vv4-36mx | high | build-time (Prisma CLI) | none yet |
| `server` → `uuid@9.0.1` | GHSA-w5hq-g745-h8pq | moderate | not runtime-reachable | none yet |
| `firebase` → `@opentelemetry/core` | GHSA-8988-4f7v-96qf | moderate | dev-tool (emulator) | none yet |
| `firebase` → `uuid@9.0.1` | GHSA-w5hq-g745-h8pq | moderate | dev-tool (emulator) | none yet |

No safe, non-breaking remediation exists for any of the four advisories today.
Every `npm audit fix --force` suggestion is a **breaking downgrade** and is
rejected. Details and review dates below.

---

## Server

### 1. `deepmerge-ts` — high — build-time only

- **Advisory:** GHSA-ggr8-5vv4-36mx — stack exhaustion when merging recursive
  object graphs. Fixed in `deepmerge-ts@8.0.0`.
- **Path:** `prisma@7.9.1` → `@prisma/config@7.9.1` → `deepmerge-ts@7.1.5`
  (pinned exactly, not a range).
- **Reachability:** build-time. `prisma` is a devDependency; `@prisma/config`
  merges `prisma.config.ts` at `prisma generate` / `prisma migrate` time. It is
  never loaded by the running server.
- **Fix status:** `prisma@7.9.1` is the latest release; no patched Prisma exists
  that pulls `deepmerge-ts@>=8`. npm's suggestion (`prisma@6.12.0`) is a
  breaking downgrade and is rejected.
- **Mitigation:** none required. Config files are not recursive object graphs,
  so the vulnerable merge path is not exercised.
- **Review date:** 2026-09-23 (re-check for a Prisma release that bumps
  `@prisma/config`'s `deepmerge-ts`).

### 2. `uuid` — moderate — not runtime-reachable

- **Advisory:** GHSA-w5hq-g745-h8pq — missing buffer bounds check in v3/v5/v6
  when a buffer is passed. Fixed in `uuid@11.1.1`.
- **Path:** `firebase-admin@14.3.0` → `@google-cloud/storage@7.22.0`
  (optionalDependency) → `gaxios@6.7.1` / `teeny-request@9.0.0` → `uuid@9.0.1`.
- **Reachability:** not runtime-reachable. The app imports only
  `firebase-admin/app` and `firebase-admin/auth` (see
  `server/dependencies/firebaseAdmin.ts`); it never imports
  `firebase-admin/storage`, so `@google-cloud/storage` and its `uuid` dependency
  are installed but never loaded. The vulnerable v3/v5/v6-with-buffer path is
  also not what `gaxios` uses (it generates v4 request IDs).
- **Fix status:** `firebase-admin@14.3.0` is the latest release; it still pins
  `@google-cloud/storage@^7.22.0`, which pins `gaxios@^6.0.2` →
  `uuid@^9.0.1`. npm's suggestion (`firebase-admin@10.3.0`) is a breaking
  downgrade and is rejected.
- **Mitigation:** none required while the app uses only Firebase Auth.
- **Review date:** 2026-09-23 (re-check for a `firebase-admin` release that
  moves `@google-cloud/storage` to `^8`, which uses `teeny-request@^11` /
  `retry-request@^9` and drops the vulnerable `uuid`).

---

## Firebase

### 3. `@opentelemetry/core` — moderate — dev-tool only

- **Advisory:** GHSA-8988-4f7v-96qf — unbounded memory allocation in W3C
  Baggage propagation. Fixed in `@opentelemetry/core@2.8.0`.
- **Path:** `firebase-tools@15.19.0` → `@google-cloud/pubsub@5.2.0` →
  `@opentelemetry/core@^1.30.1`.
- **Reachability:** dev-tool. `firebase-tools` runs the local emulator only; it
  is not part of the deployed server or client. Baggage propagation is a tracing
  feature not exercised by local emulator use.
- **Fix status:** `firebase-tools@15.28.1` (latest) still pins
  `@google-cloud/pubsub@^5.2.0`, which pins `@opentelemetry/core@^1.30.1`.
  npm's suggestion (`firebase-tools@14.23.0`) is a breaking downgrade and is
  rejected.
- **Mitigation:** none required.
- **Review date:** 2026-09-23 (re-check for a `firebase-tools` release that
  moves `@google-cloud/pubsub` to `^6`, which pins `@opentelemetry/core@^2.8.0`).

### 4. `uuid` — moderate — dev-tool only

- **Advisory:** GHSA-w5hq-g745-h8pq (same as server #2).
- **Path:** `firebase-tools@15.19.0` → `gaxios@6.7.x` → `uuid@9.0.1`.
- **Reachability:** dev-tool. Same reasoning as #3.
- **Fix status:** `firebase-tools@15.28.1` (latest) still pins `gaxios@^6.7.0`
  → `uuid@^9.0.1`. npm's suggestion (`firebase-tools@14.23.0`) is a breaking
  downgrade and is rejected.
- **Mitigation:** none required.
- **Review date:** 2026-09-23 (re-check for a `firebase-tools` release that
  moves `gaxios` to `^7`, which drops the `uuid` dependency).

---

## Verification

- `npm audit` (server): 9 findings — 6 moderate, 3 high — all accounted for above.
- `npm audit` (firebase): 5 findings — 5 moderate — all accounted for above.
- No dependency versions were changed, so the existing typecheck / lint / test
  suites are unaffected by this triage.
