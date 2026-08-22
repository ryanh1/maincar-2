# CRM Views & Grid — Authority and Capability Index

**Status:** current entry point
**Last reconciled:** 2026-08-22 (MAI-283)

Start here before planning or implementing CRM Views & Grid work.

## Current source files

| Need | Source of truth |
| --- | --- |
| Project-wide conflict resolution and supersessions | [DECISIONS.md](DECISIONS.md) |
| Saved views, lists, Kanban, sharing, URL overlay, and colour | [SPEC-CHUNK-2-views-lists-color.md](SPEC-CHUNK-2-views-lists-color.md) |
| Composite cells and the multi-object cockpit | [SPEC-CHUNK-3-composite-cockpit.md](SPEC-CHUNK-3-composite-cockpit.md) |
| CRM model, field, relation, and membership ownership | [SPEC-CRM-SCHEMA.md](../SPEC-CRM-SCHEMA.md) |
| Current implementation facts | Prisma schema/migrations, API contracts, client code, and tests |

`maincar/docs/journeys/4-crm-data-and-views.md` through
`4g-crm-ai-columns.md` are intentionally **not copied** into this repository.
They are the historical source trail for product intent. The owner below must
decide whether a journey becomes an implementation contract; no journey text
can override the sources in [DECISIONS.md](DECISIONS.md).

## Chunk boundaries

| Chunk | Owns | Does not own |
| --- | --- | --- |
| 1 — Grid Core | Scalar object grid, keyboard/editing spine, grid setup and baseline performance/accessibility | Saved-view persistence/sharing, composite resolution, record storage, lifecycle, aggregation |
| 2 — Views, Lists, Kanban & Colour | `SavedView` configuration, list surfaces, URL overlay, sharing policy seam, Kanban, and presentation colour | CRM records/membership storage, reporting/forecast aggregates, composites, lifecycle |
| 3 — Composite & Cockpit | Composite renderers/configuration, multi-object cockpit reads, edit-through, reductions, safe unlinking, drill-ins | New CRM storage, arbitrary deep joins, aggregation summaries, AI execution, lifecycle implementation |
| 4 — Record View & Lifecycle | Record drawer/page, duplicate/archive/delete and related-record navigation | Grid mechanics, view configuration, a second record store |

## Data-model boundary

The CRM Data Schema owns `ObjectDef`, `AttributeDef`, `List`, `ListEntry`,
`RecordLink`, and activity records. The grid only stores view configuration and
always reads/writes through those owned contracts. Chunk 2 owns saved-view
configuration; Chunk 3 owns composite configuration. Neither owns CRM records.

## Journey ownership map

Each historical journey has one current owner or one explicit planning
dependency. `MAI-289` is deliberately a dependency rather than a guessed
ownership assignment: it must establish the cross-project contract without
changing active work.

| Historical journey | Current owner or explicit dependency | Treatment |
| --- | --- | --- |
| 4.1, 4.1a, 4.2, 4.2a, 4.3, 4.4, 4.5, 4.6, 4.6a | CRM Data Schema | Model and field contract; consume, do not recreate. |
| 4a.1–4a.10 | MAI-289 | Explicit dependency: assign relations/activity ownership and contracts. |
| 4b.1, 4b.1a | CRM Views & Grid / Chunk 3 | Multi-object cockpit and composite-read boundary. |
| 4b.2, 4b.3, 4b.7, 4b.8, 4b.10, 4b.12, 4b.13, 4b.15 | CRM Views & Grid / Chunk 1 | Scalar grid and keyboard spine. |
| 4b.4, 4b.5 | CRM Views & Grid / Chunk 2 | View-scoped colour and typed display controls. |
| 4b.9, 4b.11 | MAI-289 | Explicit dependency: record/task surface ownership must be assigned. |
| 4b.14 | CRM Views & Grid / Chunk 3 | Explicit reductions for multi-value sort/filter only; D6 still prohibits aggregate UI. |
| 4.7, 4.8 | CRM Views & Grid / Chunk 1 | Base object grid and setup mechanics. |
| 4.9, 4.9a, 4.10 | CRM Views & Grid / Chunk 2 | Saved views, Kanban, and lists under the shared model. |
| 4.11, 4.11a, 4.13, 4.14, 4.15 | MAI-289 | Explicit dependency: record, notes/tasks, and mentions ownership/contracts. |
| 4.12, 4.16, 4.17, 4.18 | MAI-289 | Explicit dependency: search, notification, and attention ownership/contracts. |
| 4f.1–4f.7 | CRM Views & Grid / Chunk 3 | Composite-cell interaction and read-time projection. |
| 4g.1–4g.8 | MAI-289 | Explicit dependency: AI execution, provenance, and review contracts. |

## Handoff rules

- Keep the no-aggregation decision intact: counts are the only group/Kanban
  summary in this project.
- Do not alter the scope, status, or relations of an In Progress or In Review
  issue. Link to its contract instead.
- If an owner is `MAI-289`, do not implement the journey from the old source
  until that dependency records the owning project and cross-project contract.
- Before starting Chunk 2 or 3 implementation, use its current spec and the
  current codebase; use the v1 journey only to explain product intent.
