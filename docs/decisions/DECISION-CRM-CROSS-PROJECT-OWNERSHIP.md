# Decision record: CRM cross-project ownership and dependency contracts

**Status:** Accepted
**Linear:** MAI-289
**Applies to:** CRM Views & Grid and the owner projects named below.
**Last verified against repository and Linear:** 2026-08-22

---

## Decision

CRM Views & Grid is a consumer of shared CRM data and services. It owns
view configuration, keyboard-first presentation, and source-aware edit-through;
it does **not** own a second relation store, activity feed, notification system,
search index, workflow runner, or AI execution engine.

The table below assigns every surface from journeys 4a, 4d, 4e, and 4g. A
deferred owner is an explicit MAI-289 planning deferral: no implementation issue
may be added to an active project for that work without that project's owner's
approval.

| Surface | Owning project | Consumer / boundary |
| --- | --- | --- |
| Core relations, notes/tasks storage, and compact activity projection | **CRM Data Schema** (delivered shared foundation) | CRM Views & Grid and Account Timeline read it; neither duplicates it. |
| Account-timeline projection and API | **Call Intelligence — Account Timeline** | Extends `ActivityEntry`; does not create a competing feed. |
| Teammate mentions and durable in-app notification lifecycle | **CRM Notifications & Mentions Foundation** | Call Review & Collaboration and future record notes/tasks emit through the shared writer. |
| Call-specific comments and review UI | **Call Intelligence — Review & Collaboration** | A source-specific consumer of the mention/notification contract. |
| Command-palette record jump | **CRM Views & Grid** | Fast navigation only; it is not the full-text-search owner. |
| Full-text search and attention/resurfacing automation | **Deferred — future CRM Search & Attention project** | The shared primitives below are available, but no active project owns the index, search page, callback workflow, or attention queue. |
| AI field/column configuration, execution, provenance, and evals | **Deferred — future AI Fields & Columns project in the AI Copilot family** | CRM Views & Grid owns only its table-native configuration and result/review interactions. |

## Shared rules

1. **Org isolation is a contract, not a UI concern.** Every model, lookup,
   mutation, and background job is scoped to `orgId`; a supplied id never grants
   access across organizations.
2. **The source owns its record.** A view may call a typed source mutation, but
   it must not write `ActivityEntry`, notifications, provenance, or a relation
   cache directly.
3. **Authorization is rechecked at the edge.** A mutation authorizes the actor
   against the source record; a notification deep link and delivery both verify
   that the recipient may still see the source. Missing, deleted, archived, or
   unauthorized sources render only their safe snapshot or are suppressed.
4. **Store instants; render for the viewer.** Timed values are UTC instants and
   display through the viewing user's IANA time zone with an explicit zone label.
   Calendar-date values have no time or zone. Any server-side scheduling that is
   accountable to a person uses that person's `User.timeZone`, with the existing
   documented UTC fallback.
5. **Background jobs are at-least-once.** Every queue consumer needs a durable
   idempotency key and source-authorized retry behavior. A job never assumes that
   its source, its owner, or a recipient still exists when it runs.

## Contract A — relations and activity

### Canonical models

- Core-spine relations remain typed foreign keys: `Person.companyId`,
  `Deal.companyId`, `Company.parentCompanyId`, and `Call.personId`.
- A relationship that carries its own meaning/data uses its named join (for
  example `DealContactRole`). `RecordLink` is only for custom-object references
  and note/task links; it is not a universal replacement for the core spine.
- `ActivityEntry` is the single denormalized activity read model. It retains the
  real source as `(sourceType, sourceId)` and is never a second source of truth.
  Every source family has at most one row per
  `(orgId, sourceType, sourceId)`.

### API and authorization contract

- Relation actions expose typed link, unlink, and, where policy permits, create
  operations. Unlinking only removes an edge; it never archives or deletes the
  related record.
- Read APIs receive an authorized root record plus a bounded relation path.
  They return only records visible to the requester and use cursor pagination for
  high-cardinality relations.
- Activity reads use indexed, scoped `ActivityEntry` queries. The Account Timeline
  API may add its versioned projection fields, but neither it nor CRM Views & Grid
  may union Calls, Emails, Notes, Tasks, and Meetings on each screen render.

### Jobs, time, and delivery dependencies

- The source write transaction upserts its `ActivityEntry` row in the same
  transaction. Replays update the existing row; source deletion removes or safely
  unlinks its projection according to the source lifecycle.
- `ActivityEntry.occurredAt` is the event instant; it is not the projection's
  `createdAt`. The client renders it in the viewer's time zone.
- **Dependencies:** CRM Views & Grid's composite and record surfaces depend on
  CRM Data Schema's relation/action contracts. Account Timeline depends on the
  same model and owns only its extended projection and timeline read surface.

## Contract B — notes, tasks, mentions, and notifications

### Canonical models

- `Note` is rich TipTap JSON plus server-derived plain text; `Task` is a
  first-class work item. Both attach to one or more records through `RecordLink`.
  No `NoteLink`/`TaskLink` table or per-view attachment store may be introduced.
- A teammate mention is a structured TipTap mention node resolved to an active
  member id in the same organization. Plain `@text` is never a notification
  recipient.
- `NotificationObject` is the shared event fact; `Notification` is one private
  recipient lifecycle row. Recipient state (`readAt`, `archivedAt`,
  `snoozedUntil`) belongs to the recipient, not the source.

### API and authorization contract

- Note and task routes own their CRUD and source-specific policy. Mentions are
  resolved before the source write commits; inactive or foreign members are
  rejected rather than stored as unverified text targets.
- A source calls the shared mention resolver and notification writer with a
  deterministic event key, a safe source snapshot, and candidate recipient ids.
  The writer excludes the actor and validates active membership.
- Inbox actions are recipient-scoped. Deep-link resolution and any later delivery
  channel recheck source access; notification snapshots must be safe to render if
  the source has disappeared.

### Jobs, time, and delivery dependencies

- Note/task timeline events upsert `ActivityEntry` with the source write; no
  second feed fan-out job is permitted.
- In-app mention fan-out is immediate and idempotent. Batching, email, push,
  quiet hours, task reminders, and workflow-generated notifications are not
  implicitly owned by the foundation unless its owner accepts a scoped extension.
- `dueAt`, `remindAt`, and snooze times are instants. A human-facing reminder or
  due time renders in the recipient/viewer's explicit zone; date-only task
  semantics remain date-only.
- **Dependencies:** Call Review & Collaboration consumes this contract for call
  comments. Future CRM notes/tasks consume the same contract. CRM Views & Grid
  may render inbox/task state but does not create another mention or notification
  pathway.

## Contract C — search, notifications, and attention

### Full-text search: approved deferral

Full-text search is explicitly deferred to a future **CRM Search & Attention**
project. CRM Views & Grid continues to own its record-jump command palette and
grid-local find only. It must not present either as a promise to search note,
email, text, or transcript bodies.

The future project's contract is:

- Index textual source rows through a source-agnostic search service. The first
  implementation is PostgreSQL `tsvector` plus GIN; a later Typesense or
  Meilisearch replacement stays behind the same service interface.
- Search APIs are org-scoped, source-authorized, cursor-paginated, and return a
  safe typed hit (source kind, source id, snippet, highlighted terms, and a
  source destination). A result may not expose text from a source the viewer
  cannot open.
- Source writes enqueue or apply an idempotent index update with near-real-time
  freshness. Deletion/archival removes or makes the index row unreachable.
- Search carries no person-accountable time rule. Result timestamps, when shown,
  obey the shared rendering rule above.

### Attention and resurfacing: approved deferral

`attentionStatus`, `attentionReason`, `callbackDate`, and owner fields remain
canonical CRM data, already modeled by the shared schema. The behaviour that
turns a callback date into a task, notification, and "Resurfacing today" queue is
also deferred to the future **CRM Search & Attention** project, coordinated with
the future workflow owner.

That project must create a Task and a shared notification rather than silently
changing attention status. It schedules the first run for the next business
morning in the accountable owner's time zone, rechecks owner/archive state at
execution, and uses a durable idempotency key so a retry cannot create duplicate
tasks or notifications.

### Notification boundary

The current Notifications & Mentions Foundation owns the durable in-app event and
recipient lifecycle described in Contract B. It does not thereby own universal
search, attention policies, or automation triggers. Those sources must be
explicitly accepted by its owner before they emit events into the foundation.

## Contract D — AI fields and table-native AI columns

### Approved deferral and single source of truth

AI-field/column execution is explicitly deferred to a future **AI Fields &
Columns** project in the AI Copilot family. Journey 4g is the grid interaction
surface; it is not a separate data or execution system.

The future owner must use one canonical AI field definition attached to the CRM
schema (`AttributeDef` with an AI field definition/configuration) and one
provenance path for every written value. It must not ship an independent
`AiColumn` store alongside an AI-field store. The grid derives a column from that
shared definition.

### API and authorization contract

- Configuration writes, runs, review decisions, and field writes are separate
  authorized operations. A caller may not configure, read input context, run, or
  accept a proposal beyond their CRM record permissions.
- The runner receives pre-authorized, explicit record/context data. It does not
  discover data after a prompt is drafted, and any user-visible output or stored
  proposal is based on that same input.
- Suggested values are durable proposals carrying current value, cast suggested
  value, source references, model, and prompt version. Accept/edit/reject actions
  are idempotent and create the normal field-history/provenance record. Human edits
  pin a value against automatic recompute.

### Jobs, time, and delivery dependencies

- Manual and batch runs use the shared AI-field queue with bounded batches, rate
  limits, retry, and deterministic per-record/per-field idempotency. A failed cell
  remains visible and retryable; it is never silently blank.
- Relevant activity can debounce a recompute; a staleness sweep is a safety net,
  not the primary trigger. Both honor user pins and record/org authorization at
  execution time.
- AI jobs operate on instants and preformatted date/time context. If an output is
  shown to a person, the consuming client renders it in the viewing user's zone;
  the model is never asked to invent a time zone.
- **Dependencies:** CRM Views & Grid waits for this contract before adding a live
  AI-column control. Until then, it may not render a control that appears to run
  AI work. The future owner depends on CRM Data Schema, the activity contract,
  provenance, and the notification review-queue contract.

## Delivery order and non-goals

1. CRM Views & Grid continues to consume existing relations, `RecordLink`, and
   `ActivityEntry` only.
2. Account Timeline extends the established activity projection, not a new feed.
3. Notifications & Mentions Foundation remains the only generic mention/inbox
   foundation; Call Review is its first source consumer.
4. Full-text search/attention automation and AI fields/columns stay deferred until
   their named owner projects are created and accept scoped implementation work.

This decision deliberately does **not** create implementation issues, migrations,
routes, background workers, or UI controls in any active project. It is a contract
for those owners to reference when their work is scheduled.

## Source ledger

- `docs/specs/SPEC-CRM-SCHEMA.md` — typed core relations, `RecordLink`,
  `ActivityEntry`, Task/Note, org isolation, and time-zone conventions.
- `docs/journeys/4a-crm-relations-and-related-records.md` — related-record and
  activity-feed requirements.
- `docs/journeys/4d-crm-records-notes-tasks.md` — notes, tasks, and mention
  journeys.
- `docs/journeys/4e-crm-search-notifications-attention.md` — search, notification,
  attention, and callback-resurfacing requirements.
- `docs/journeys/4g-crm-ai-columns.md` and `docs/journeys/7i-ai-fields.md` —
  table-native AI interactions and the shared AI-field feature boundary.
- Linear projects: CRM Views & Grid; CRM Notifications & Mentions Foundation;
  Call Intelligence — Account Timeline; Call Intelligence — Review &
  Collaboration.
