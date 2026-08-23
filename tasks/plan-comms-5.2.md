# Plan: Doc 5 Journey 5.2 — Relate emails and events to CRM records

**Spec:** [docs/journeys/5-comms-email-and-calendar.md](../docs/journeys/5-comms-email-and-calendar.md) §5.2 (5.2a–5.2f).
**Linear project:** none yet (proposed: `Comms — Email & Calendar Sync` · team `MAI`).
**Issues:** drafted below, awaiting approval before creation.

## What already exists (do not rebuild)

- **Models:** `Email`, `EmailParticipant`, `EmailAttachment`, `Meeting`,
  `MeetingAttendee`, `ActivityEntry`, `MailAccount`, `OAuthConnection`,
  `Person`, `PersonEmail`, `Company`, `Deal` — all in `server/prisma/schema.prisma`.
- **Provider seams:** `MailProvider` (`listMessagesSince`/`listEventsSince`,
  cursor-based) and `CalendarProvider` (`listEvents`) — both provider-agnostic,
  both already built and contract-tested.
- **Queue:** `server/src/jobs/queue.ts` (pg-boss) with `sendJob`/`scheduleJob`/`workJob`.
- **Read routes:** `server/src/routes/emails.ts`, `meetings.ts` (read-only).
- **The phone analog:** `server/src/lib/callMatch.ts` — number → Person/Company.
  The new matcher is the email/domain analog of this.

## What is missing (the work)

The **write side** of sync: a shared matcher, the exclusion rules, and the four
background jobs (back-fill, live poll, rematch, purge) plus their settings surface.

## Dependency graph

```
                    5.2-1  matcher engine (5.2c)
                    resolve + attach + derived fields + fixtures
                              │
              ┌───────────────┼────────────────┐
              │               │                │
        5.2-2 capture      5.2-4 back-fill  5.2-5 live poll
        settings +          (5.2a) F2-        (5.2b) F1
        exclusion rules     backfill + panel  cron + push
        (5.2f settings)          │                │
              │                  │                │
        5.2-3 retroactive        └──────┬─────────┘
        purge (5.2f)                     │
        F2-purge                   5.2-6 unmatched hold
                                         + rematch (5.2e)
```

## Why the slices are shaped this way

**5.2-1 is the foundation and has no user-facing surface on its own.** It is the
shared "resolve a participant/identifier to CRM records" service the doc calls out
(§5.2 "What record types this matches"). Its only witness is the matcher fixture
suite (≥98% precision). Everything else feeds it.

**5.2-2 and 5.2-3 are the exclusion half of 5.2f, split on purpose.** The settings
+ evaluator (5.2-2) is a config surface; the retroactive purge (5.2-3) is a
distinct job with its own flow ("add exclusion → purge past → toast"). They are one
journey but two tickets so neither is L-sized.

**5.2-4 and 5.2-5 are the two sync jobs, both consumers of the matcher.** Back-fill
(5.2-4) is the first user-visible outcome (day-one history); live poll (5.2-5) is
the steady-state. They share the matcher but touch different provider mechanics
(history paging vs delta cursors + push).

**5.2-6 depends on the matcher and coordinates with doc 5a's retention sweep (F6).**
The 30-day hold is enforced by F6, not a new timer — this ticket builds the hold
buffer + rematch and integrates with F6, which lives in doc 5a.

## Out of scope (explicit)

- **Auto-create People/Companies** — the opt-in admin setting is specced in doc 5a
  §5.3a. This journey only *feeds* it (matcher step 6 is a hook, not built here).
- **Campaign / Script objects** — added by the doc header, but not referenced by 5.2.
- **Compose/send (5.5), calendar UI (5.6), OAuth (5.7)** — separate journeys.

## Rules that apply to every ticket

Inherited from [AGENTS.md](../AGENTS.md) and [.claude/rules](../.claude/rules/):

- `npm test && npm run typecheck && npm run lint` pass before any commit. Red blocks.
- **A feature commit carries its own tests.** Never as a follow-up.
- Every background job states its **trigger**, **algorithmic steps**, and **pg-boss
  params** (queue, retryLimit, singletonKey) — the doc's "background jobs" convention.
- Every time-of-day shown to a person renders in an explicit timezone with a zone
  label; never a bare local time.
- Org isolation: every query carries `orgId`; a matcher must never resolve across
  tenants.

## Task list (draft tickets — awaiting approval)

| # | Ticket | Journey | Size | Depends on |
|---|--------|---------|------|------------|
| 1 | Matcher engine (resolve + attach + derived fields + fixtures) | 5.2c | M/L | — |
| 2 | Capture settings + exclusion rules (Settings → Integrations → Capture) | 5.2f | M | 1 |
| 3 | Retroactive purge job (F2-purge) + add-exclusion flow | 5.2f | S/M | 2 |
| 4 | First-connect back-fill sync (F2-backfill) + import progress panel | 5.2a | M | 1 |
| 5 | Live incremental poll (F1) — 5-min cron + push + cursor-expiry resync | 5.2b | M/L | 1 |
| 6 | Unmatched hold + back-attach rematch (F2-rematch) | 5.2e | M | 1, (5a F6) |

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Matcher precision regressions (wrong attach worse than a miss) | High | Fixture suite with ≥98% precision bar, green in CI before any sync change ships |
| Provider cursor semantics differ (Gmail `historyId` vs Graph `deltaLink`, per-folder) | Med | Both behind the existing `MailProvider`/`CalendarProvider` seams; 404/410 → full resync handled explicitly |
| Ingesting the whole mailbox (no CRM match) | High | "≥1 CRM match" filter is the gate; unmatched → 30-day hold, never stored |
| Hold buffer grows unbounded | Med | Enforced by doc 5a F6 retention sweep, not a new timer |
| Push subscriptions lapse (Gmail ~7-day `watch`) | Med | 5-min cron is the floor; renew `watch` daily, alert before expiry |

## Open questions

- **Linear project:** create a new `Comms — Email & Calendar Sync` project, or file
  these under an existing project? (No comms project exists today.)
- **5.2-5 (live poll) is M/L** — split push-subscription into its own ticket, or
  keep as one?
- **F6 (retention sweep) in doc 5a** — does it exist yet, or does 5.2-6 need to
  coordinate with a not-yet-built job?
