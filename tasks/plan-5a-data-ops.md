# Plan: Doc 5a Journey 5.1 + 5.1a — Bulk actions & app-wide undo

**Spec:** [docs/journeys/5a-crm-data-ops-and-hygiene.md](../docs/journeys/5a-crm-data-ops-and-hygiene.md) §5.1 (bulk edit/delete/add-to-list) and §5.1a (undo + undo history).
**Linear project:** `Doc 5a — CRM Data Ops & Hygiene` · team `MAI`.
**Label:** `deepseek-v4-pro` on every issue.

## What already exists (do not rebuild)

- **Row selection:** `vite/src/components/crm/useRowSelection.ts` (checkbox, shift-click range, header checkbox, `allInFilter`), `SelectionBanner.tsx` ("All N on screen — Select all M in this view").
- **Bulk action bar:** `vite/src/components/crm/BulkActionBar.tsx` — already has Add to list, Change owner, Export, Delete, Clear. Missing: Edit a field, Create task, Add to campaign.
- **Server bulk route:** `POST /api/orgs/:orgId/objects/:id/bulk` in `server/src/routes/objects.ts` — already handles `delete`, `changeOwner`, `addToList`, `export` via `selectedRowPages` (500-row pages). Missing: `editField`, `createTask`, `addToCampaign`, and the background-job path.
- **Field history write path:** `server/src/crm/fieldHistory.ts` (`recordFieldHistoryInTx`, `diffFieldValues`, `loadHistoryAttributes`) — the before→after diff every write already records.
- **Soft delete:** `deletedAt` on `Record`/`Person`/`Company`/`Deal`/`Call` (30-day trash).
- **Field→component map:** `vite/src/components/crm/FieldValueEditor.tsx` — the single source of truth for "which input matches which field type" (spec 5.1.3 says bulk edit must reuse it, not fork it).
- **Queue:** `server/src/jobs/queue.ts` (pg-boss) with `sendJob`/`workJob` + `JOB_NAMES`/`QUEUE_DEFAULTS`.

## What is missing (the work)

1. **Bulk "Edit a field"** — the field→component popover + a server `editField` action that writes through the normal record-write path (field history per record).
2. **Bulk "Create task"** — one task linked to all selected records, or one task per record (radio).
3. **The "big job" path** — a `bulk-mutate` pg-boss queue for any action over ~200 rows: progress toast, cancel, retry-failed, shimmer, non-locking table.
4. **Delete confirm + typed count** for very large deletes.
5. **App-wide undo** — `UndoEntry` schema, a server compensating-write undo endpoint, a client stack (zundo), the ⌘Z/⌘⇧Z shortcut, the undo-history panel, and the concurrency guard + redo.

## Out of scope (deferred, noted so granularity is not silently lost)

- **"Add to campaign"** (spec 5.1.2) — blocked: there is no `Campaign` model yet (doc 5 comms). Ticket deferred until campaigns exist.
- **Grouped audit entry** (spec 5.1.4 point 4) — the `AuditLog` model is specced in Journey 5.14b, not 5.1/5.1a. The bulk-mutate job writes field history now; the grouped `AuditLog` row lands with 5.14b.
- **`Record.mergedIntoId` / `deletedById`** (spec data model) — those belong to 5.3c/5.3d, not 5.1/5.1a.
- **Bulk action bar "slides up from bottom center"** (spec 5.1.1) — the bar is currently a top bar; repositioning is a small polish item folded into the bulk-edit client ticket.

## Dependency graph (vertical slices)

```
Slice A — bulk edit a field
  5a-1  server editField action (inline ≤200)   ──┐
  5a-2  client popover + field→component map       │ (5a-2 blockedBy 5a-1)
                                                  │
Slice B — bulk create task                         │
  5a-3  one task linked to all / one per record    │
                                                  │
Slice C — the big-job path                         │
  5a-4  bulk-mutate job + progress endpoint  ───────┼─ (5a-4 blockedBy 5a-1)
  5a-5  client progress toast/cancel/retry/shimmer  │  (5a-5 blockedBy 5a-4)
                                                  │
Slice D — delete confirm                           │
  5a-6  delete confirm + typed count               │
                                                  │
Slice E — app-wide undo                            │
  5a-7  UndoEntry schema + mirror endpoints  ──────┼─ (independent)
  5a-8  server undo apply (compensating writes)    │  (5a-8 blockedBy 5a-7)
  5a-9  client stack + toast Undo + ⌘Z/⌘⇧Z         │  (5a-9 blockedBy 5a-8)
  5a-10 undo history panel (last 50, stack)        │  (5a-10 blockedBy 5a-9)
  5a-11 concurrency guard + redo                   │  (5a-11 blockedBy 5a-8)
```

## Why the slices are shaped this way

- **5a-1 / 5a-2 are split server/client** because together they touch 7+ files (objects.ts, valuesValidator, fieldHistory, crmTypes, BulkActionBar, a new dialog, the FieldValueEditor extraction, useBulkRecords, plus tests) — an L/XL. Each half is independently testable (route tests vs component tests) and the pair is the vertical slice.
- **5a-4 / 5a-5 are split the same way** for the same reason: the pg-boss job + progress endpoint is a server capability; the progress toast/cancel/retry/shimmer is a client capability.
- **5a-7 through 5a-11 are the undo slice, split into five** because undo is inherently cross-cutting: schema+mirror, the compensating-write endpoint, the client stack+shortcut, the history panel, and the concurrency/redo guard are each a distinct, testable unit. 5a-7 is the foundation with no user surface of its own (its witness is the schema + mirror-endpoint tests).
- **5a-6 is small and standalone** — a confirm dialog + typed-count gate, no server change (soft-delete already exists).

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Undo as compensating writes can clobber a newer edit | High | 5a-11 concurrency guard: compare live value to recorded `after`; prompt "changed since — undo anyway?" |
| `bulk-mutate` double-applies on retry | High | idempotency key `(batchId, recordId)`; `singletonKey = batchId`; honor cancel flag between chunks |
| Field→component map forks (two sources of truth) | Med | 5a-2 extracts the map from `FieldValueEditor.tsx` into one shared module, never a copy |
| UndoEntry table grows unbounded | Low | per-user per-session rows, cleared on sign-out; index `(orgId, userId, sessionId, seq)` |

## Open questions

- **"Add to campaign"** — build now against a placeholder, or defer until doc 5 campaigns exist? (Recommended: defer.)
- **Undo mirror retention** — the spec says the stack clears on sign-out; should the `UndoEntry` rows be hard-deleted on sign-out or soft-kept for a short window?
