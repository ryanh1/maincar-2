# Implementation Plan: Journey 4.16 — Notification Inbox & Settings

## Overview

Complete the notification inbox and its settings (doc 4e, Journey 4.16). The
foundation already shipped under the "CRM Notifications & Mentions Foundation"
project: `NotificationObject` + `Notification` schema, the idempotent
`fanOutNotification` writer, the mention resolver, the inbox API
(list/bulk/patch with read/archive/snooze), and the app-shell bell + notification
center drawer (MAI-235/236/237/238).

This plan covers what 4.16 still requires, sliced vertically (schema + API + UI
per slice). Tasks are tracked in Linear (team **Maincar2**, project **CRM
Notifications & Mentions Foundation**); this file is the ordered index.

## Current state vs. spec

| 4.16 subsection | Status |
|---|---|
| 4.16.1 Read the inbox (bell, card, quick actions) | **Done** (MAI-238) |
| 4.16.1.3 Bundling ("Ana and 2 others commented") | **Missing** |
| 4.16.2 Tabs (Inbox/Unread/Snoozed/Archived) | **Done** (Unread is a read filter) |
| 4.16.2.2 Filters by Type / Object | **Missing** |
| 4.16.2.2 Filter by Assignee (manager view) | **Deferred** (single-user today) |
| 4.16.2.3 Bulk actions (mark all read, archive all) | **Done** |
| 4.16.2.4 Keyboard triage (`u`/`e`/`h`) | **Missing** |
| 4.16.3 Channels grid (Settings → Notifications) | **Missing** |
| 4.16.4 Timing + quiet hours | **Missing** |
| 4.16.5 Bundling rule (immediate vs. batched) | **Missing** |
| §B Email/push delivery + batching | **Deferred** (opt-in interrupting channels) |

## Architecture decisions

- **Bundling is a schema change.** The doc's data model gives `Notification` a
  `batchKey` (recipient + verb + object) and `objectIds String[]` (folded
  `NotificationObject` ids). Today `Notification` has a single required
  `notificationObjectId` with a unique `(object, recipient)` key. Bundling moves
  that to a one-to-many fold. This is the largest slice and the one that most
  changes the read path.
- **Event-kind taxonomy is a plain string set**, not a Prisma enum (per
  `.claude/rules/database-and-prisma.md` → No Enums). Kinds: `mention`,
  `assignment`, `comment`, `status_change`, `team`. The `verb` field already
  exists on `NotificationObject`.
- **Channels are a fixed list** (`inbox`, `email`, `push`, `slack`); `inbox` is
  always-on. `slack` is deferred to doc 11a.
- **Settings are per-user**, stored as a model (not a JSON blob) so the grid and
  timing are queryable and defaultable.
- **Email/push delivery is deferred** to a later slice. The writer already
  documents that channel delivery is a separate concern; the settings grid and
  timing model are built now so delivery can consume them later.

## Task List (ordered index — tracked in Linear)

### Phase 1 — Core inbox (the calm inbox)

- **Task 1a — Bundling: schema + writer batching** (4.16.5). Add `batchKey` +
  `objectIds String[]` to `Notification`; batch noisy events on a sliding window
  keyed by `recipient + verb + object`; mentions/assignments stay immediate.
- **Task 1b — Bundling: read aggregation + card UI** (4.16.1.3). Aggregate folded
  objects into one card ("Ana and 2 others commented…") in the drawer.
- **Task 2 — Filters by type & object** (4.16.2.2). Extend the list query with
  `verb` and `objectType` filters; add filter controls to the drawer.
- **Task 3 — Keyboard triage** (4.16.2.4). `u`/`e`/`h` shortcuts in the drawer.

### Phase 2 — Settings

- **Task 4 — Channels grid** (4.16.3). `NotificationPreference` model, GET/PUT
  API, Settings → Notifications tab with the kinds × channels grid and defaults.
- **Task 5 — Timing & quiet hours** (4.16.4). Extend the preference model with
  timing (immediate/digest/off) and quiet hours (start/end/timezone).

### Phase 3 — Deferred (not ticketed now)

- Email/push delivery + batching (§B), assignee filter, Slack channel, team
  broadcast kind.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bundling schema change breaks the existing read path | High | Ship bundling as its own slice with a migration; keep the old single-object read working until the new fold lands |
| Event-kind taxonomy drifts from `verb` values already written | Med | Define the canonical kind set in one module; map existing `verb` values to it |
| Quiet-hours timezone bugs | Med | Reuse `User.timeZone` + `vite/src/lib/datetime.ts`; never invent a zone |

## Open questions

- ~~Should bundling be one ticket or split?~~ → Split into 1a (write-time) and 1b (read-time).
- ~~Is email/push delivery in scope now?~~ → Deferred.
