---
paths:
  - "server/**"
  - "vite/src/**"
---

# Where tests live, and what every feature ships with

> Moved out of the always-loaded CLAUDE.md so it loads only when you
> touch code that needs it. Same authority as CLAUDE.md. Do not duplicate it back.

- **New features ship with tests.** Routes (valid/invalid/edge), components
  (interaction, loading, error). Mock external services.
- **Where tests live.** Server tests go in `server/src/__tests__/`, mirroring the folder they
  cover (`server/src/routes/__tests__/auth.test.ts` for `server/src/routes/auth.ts`). Client tests sit beside the file they cover
  (`SomeComponent.test.tsx` next to `SomeComponent.tsx`); shared render helpers and mocks live
  in `vite/src/test/utils`.
