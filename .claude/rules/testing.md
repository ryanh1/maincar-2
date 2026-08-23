---
paths:
  - "server/**"
  - "vite/src/**"
---

# Where tests live, and what every feature ships with

- **New features ship with tests.** Routes cover valid, invalid, and edge behavior. Components cover interaction, loading, and error behavior. Mock external services.
- **Server tests** mirror source paths under `server/src/__tests__/` or the neighboring `__tests__` folder already used by that area.
- **Client tests** sit beside the file they cover; shared render helpers and mocks live in `vite/src/test/utils`.
- **Focused development checks** use one named Vitest file through `mc-gate --focused`. This uses one test worker.
- **Final checks** use `mc-gate --check` with the specific test files that cover the change. TypeScript, lint, final checks, and delivery checks use at most two test workers.
- **Delivery checks** run on one issue at a time after it is merged onto newest `main` in a temporary clone.
- **Do not require broad suites.** Do not use `npm test`, `npm run verify`, or whole server, web, or integration suites for delivery. Name exact relevant files, including exact database integration files when needed.
- **Do not require browser testing.** Playwright and manual browser journeys are not commit or delivery requirements.
