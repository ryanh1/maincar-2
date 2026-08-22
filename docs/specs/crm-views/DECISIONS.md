# CRM Views & Grid — Project Decisions

**Status:** current project-wide decision record
**Last reconciled:** 2026-08-22 (MAI-283)

This file restores the decision authority referenced by the Chunk 2 and Chunk 3
specifications. It resolves project-wide conflicts; it does not replace the
implementation detail in those specifications or the CRM Data Schema's model
contracts.

## D1 — Views configure records; they never become a record store

`SavedView` and its configuration describe how existing CRM records are read,
arranged, filtered, and presented. A view cannot own a duplicate row, a
flattened cockpit record, or a second copy of a field. Writes always use the
record, relation, or activity API that owns the source value.

## D2 — One live view configuration, with explicit persistence boundaries

Header controls and the grid toolbar mutate one `ViewConfig`. Saving writes the
configuration to `SavedView.configJson`; a valid URL overlay is session-only
until the user explicitly saves it. URLs contain configuration, never CRM
record values or PII.

## D3 — The CRM Data Schema owns model and membership contracts

`ObjectDef`, `AttributeDef`, `List`, `ListEntry`, `RecordLink`, and activity
models remain owned by the CRM Data Schema. CRM Views & Grid may consume those
contracts and add view configuration, but it may not replace them with
`ListEntity`, a second record table, or ad-hoc field storage.

## D4 — Grid interaction is Sheets-first and keyboard-complete

Click selects, `Enter` edits, typing replaces the focused editable value, and
`Space` or the row affordance opens a record. Every grid control must have a
keyboard path and predictable focus return. A row open is never silently
substituted for an edit.

## D5 — Presentation is not canonical data

Saved-view layout, formatting, header colour, conditional colour, and manual
cell paint are presentation configuration. They are scoped as the relevant
specification states, do not alter a CRM record, and do not leak into exports
or unrelated views.

## D6 — No aggregation UI in CRM Views & Grid

Group sections and Kanban headers may show record counts only. The grid does
not render sums, averages, weighted pipeline values, bottom summary bars, or
other aggregate UI. When a multi-value column needs a scalar to sort, filter,
group, or conditionally colour, Chunk 3's explicit `reduce` contract computes
that scalar without presenting it as an aggregate. Forecasting and reporting
belong to their dedicated surfaces.

## D7 — Composite values are read-time projections

Composite cells resolve normalized source records at read time and edit through
to those records. They are not persisted flattened values. Removing an item
defaults to unlinking; archive and lifecycle semantics remain the Chunk 4
contract.

## D8 — Accessibility, authorization, and timezone rules are non-negotiable

Colour is never the sole cue, each view/list action passes through its
authorization policy, and user-facing timestamps use the existing formatting
helpers with an explicit timezone label. This project does not invent a time
zone, public sharing bypass, or one-off access policy.

## Superseded journey decisions

The sibling `maincar` repository's journey documents remain historical product
evidence, not implementation authority for this repository. In particular:

| Older journey material | Current decision |
| --- | --- |
| Kanban `count · Σ amount` or weighted-total language | Superseded by D6; only record counts appear in CRM Views & Grid. |
| A `ListEntity` or view-owned membership model | Superseded by D3; use `List` and `ListEntry`. |
| A flattened multi-object/cockpit row or stored composite value | Superseded by D1 and D7; resolve normalized records at read time. |
| Any v1 storage-shape detail that conflicts with `SPEC-CRM-SCHEMA.md` or shipped schema | Superseded for maincar-2 by the current schema contract and shipped code. |

## Authority order

Use the first applicable source. A lower source can supply context only when it
does not conflict with a higher source.

1. Shipped maincar-2 behavior: Prisma schema/migrations, server contracts,
   client code, and tests.
2. This decision record for project-wide CRM Views & Grid conflicts.
3. The approved Chunk 2 and Chunk 3 implementation specifications for their
   respective scopes.
4. `docs/specs/SPEC-CRM-SCHEMA.md` for CRM model ownership and contracts.
5. Current Linear issue descriptions and comments for active work boundaries;
   do not change another issue's scope, status, or relations from this project.
6. `maincar/docs/journeys/4*.md` as historical product intent and benchmark
   evidence only.

If the top two sources disagree, stop and record the conflict in a new planning
issue rather than silently re-deciding it.
