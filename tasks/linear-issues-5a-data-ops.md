# Linear issues — Doc 5a Journeys 5.1 + 5.1a

Project: **Doc 5a — CRM Data Ops & Hygiene** · team `MAI` · label `deepseek-v4-pro` on every issue.

| # | Key | Title | Blocked by |
|---|-----|-------|-----------|
| 1 | MAI-451 | Bulk "Edit a field" — server editField action (inline ≤200) | — |
| 2 | MAI-452 | Bulk "Edit a field" — client popover + shared field→component map | MAI-451 |
| 3 | MAI-453 | Bulk "Create task" — one task linked to all vs one per record | — |
| 4 | MAI-454 | bulk-mutate background job + progress endpoint (>200 rows) | MAI-451 |
| 5 | MAI-455 | Big-job client — progress toast, cancel, retry-failed, shimmer | MAI-454 |
| 6 | MAI-456 | Bulk delete confirm + typed count for very large deletes | — |
| 7 | MAI-457 | UndoEntry schema + mirror endpoints (per-user session stack) | — |
| 8 | MAI-458 | Server undo apply — compensating writes (not DB rollback) | MAI-457 |
| 9 | MAI-459 | Undo client — stack (zundo), toast Undo, ⌘Z/⌘⇧Z shortcut | MAI-458 |
| 10 | MAI-460 | Undo history panel (last 50, stack semantics) | MAI-459 |
| 11 | MAI-461 | Undo concurrency guard ("changed since") + redo | MAI-458 |

## Deferred (not ticketed — noted in plan)

- **"Add to campaign"** (spec 5.1.2) — blocked: no `Campaign` model yet (doc 5 comms).
- **Grouped audit entry** (spec 5.1.4 point 4) — `AuditLog` is Journey 5.14b.
- **`Record.mergedIntoId` / `deletedById`** — Journey 5.3c/5.3d.
