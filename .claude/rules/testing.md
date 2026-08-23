---
paths:
  - "server/**"
  - "vite/src/**"
---

# Where tests live, and what every feature ships with

- **New features ship with tests.** Routes cover valid, invalid, and edge behavior. Components cover interaction, loading, and error behavior. Mock external services.
- **Server tests** mirror source paths under `server/src/__tests__/` or the neighboring `__tests__` folder already used by that area.
- **Client tests** sit beside the file they cover; shared render helpers and mocks live in `vite/src/test/utils`.
- **Focused development checks** use one named Vitest file through `mc-gate --focused`. Playwright is never accepted or reserved by the coordination gate.
- **Delivery tests** run on the combined train tree, not once per waiting session. Enqueue records focused tests and coverage intent; the train selects low, normal, or high verification and records exactly what ran.
- **Browser journeys** remain required for visible behavior, but they are manual/runtime verification and never part of this local delivery gate.
