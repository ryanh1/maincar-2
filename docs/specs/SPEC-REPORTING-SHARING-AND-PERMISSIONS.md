# SPEC — Reporting Sharing, Permissions & Row-Level Visibility

*Companion deep-dive broken out of [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md) (§13 completeness review). Owns who can view, edit, share, subscribe to, and export reports and dashboards — and, critically, how a drill-through or export never exposes a record the viewer couldn't otherwise open. Security-sensitive; this is the highest-risk surface in the reporting feature.*

---

## 1. The model in one paragraph

**View is open by link; edit is scoped; the underlying records are always gated.** Any org member with a report/dashboard link can **view** it (its numbers and charts). **Edit** stays with the owner plus explicit editors. But any **drill-through to individual records — or export of them — obeys row-level record visibility**, so open viewing exposes the *aggregate*, never a specific record the viewer couldn't already open. No anonymous/public links in v1.

This deliberately promotes ease of access (paste a report link in Slack, a teammate just sees it) while keeping the record-level data safe.

---

## 2. The three layers

| Layer | Who | Enforcement point |
|---|---|---|
| **View a report/dashboard** | any member of the `orgId`, by link | org-scoped; no per-report view ACL |
| **Edit** (config, rename, delete, add to dashboard) | `ownerId` + `editors[]` | checked on every mutation route |
| **See a specific record** (drill-through, export) | whoever may open that record in the CRM | row-level visibility, applied to the drill/export query |

- **View = org-wide by link.** Every saved report and dashboard has a stable in-app URL; any org member with it can open and view. No "request access" wall.
- **Edit stays scoped.** Default: only the `owner` edits. The owner can add named `editors[]` as co-owners. Frictionless to read, controlled to change.
- **Record visibility is the safety rail.** The report definition and its aggregate view are open, but drill-through/export show only records the viewer is allowed to see. See [§3](#3-row-level-visibility--the-enforcement-that-matters).

---

## 3. Row-level visibility — the enforcement that matters

**Today (v1): `orgId` is the visibility boundary.** maincar-2's CRM schema is `orgId`-tenant with no per-record ACL yet (multi-user roles/permissions are a separate future spec). So in v1, every member of an org may see every record in that org — and the aggregate + drill-through are consistent by construction.

**The design must not assume that stays true.** When record-level visibility lands (ownership scoping, team boundaries, private records), the reporting engine must defer to it **without a rewrite**:

- **The aggregate may count records the viewer can't open** (a manager's number over a team), but the **drill-through and export re-filter to the viewer's visible set** — so the number can be higher than the rows shown, with an honest note: *"Some records are hidden by your access."*
- **Enforcement is centralized:** drill-through and export run through a **`visibleRecords(viewer, object)` predicate** injected into the row query — the same predicate the CRM grid uses. Reporting never invents its own visibility logic; it calls the CRM's.
- **The compiler always injects `WHERE "orgId" = $session`** ([architecture §4a](SPEC-REPORTING-ARCHITECTURE.md#4a-the-safety-rule--you-cannot-parameterize-identifiers)) — the non-negotiable tenant floor, independent of any record-level rules above it.

**Future per-report "restricted" flag.** If an org ever needs stricter *aggregate* secrecy (hide the numbers, not just the rows), that's a later per-report `restricted` flag with its own view-ACL — explicitly **not** the default, noted here so the model has a growth path.

---

## 4. Export & subscription permissions

Exports and scheduled deliveries **distribute** data, so they carry extra rules:

- **An export obeys the same row-level visibility** as drill-through — you can only export rows you can see.
- **Every export is audited** (who, what report, when, row count) — it's a data-egress event.
- **Large exports** run as async jobs scoped to the requesting viewer's visibility ([architecture §9](SPEC-REPORTING-ARCHITECTURE.md#9-hard-problems-tradeoffs-and-what-we-will-not-promise)).
- **Scheduled delivery (R11)** sends the report as computed for **the subscription owner's** visibility, to the recipients they choose — a subscription can't be used to leak a manager's wider numbers to a rep. Recipients outside the org (arbitrary email) are gated; Slack channel delivery follows the org's Slack connection.
- **Live spreadsheet sync (R14)** uses a tokened endpoint scoped to the creating user's visibility, revocable, and audited.

---

## 5. Dashboards & profiles

- **Dashboards** ([R8](SPEC-REPORTING-DASHBOARDS.md)) use the identical model: view = org-wide by link, edit = owner + editors, each tile's drill-through obeys row-level visibility.
- **A tile the viewer partly can't see** renders the aggregate but drills to only-visible rows (same rule as §3).
- **Member profiles** ([R9](SPEC-REPORTING-ENGINE.md#r9--member-profile-pages-later)): default header fields (name, title, email, phone, manager, team, tz) are **org-visible by design** (it's an internal directory). A **personal dashboard** pinned to a profile renders only the reports the *viewer* may see, so a profile never leaks another rep's private numbers. No profile is visible outside the org.

---

## 6. Threat model & the edge cases

| Risk | Mitigation |
|---|---|
| **Cross-tenant leak** (org A sees org B) | compiler injects `orgId` server-side always; tenant-isolation tests ([testing §3](SPEC-REPORTING-TESTING.md#3-security--tenant-isolation--injection)) |
| **Aggregate leak of restricted records via drill** | drill/export re-filter to `visibleRecords(viewer)`; aggregate ≥ rows-shown with an honest note |
| **Over-broad share** | view is org-scoped only — never public; no anonymous links in v1 |
| **Export exfiltration** | export obeys visibility + audited + async-scoped |
| **Subscription used to leak** | delivery computed for the owner's visibility; external recipients gated |
| **A report references an object/field the viewer can't see** | the report still renders (view is open) but drilled rows respect visibility; a field the viewer can't see is omitted from drill columns |
| **Owner leaves the org** | reports/dashboards are org-owned assets; on owner deactivation, ownership transfers to an admin (not orphaned/inaccessible) |
| **Deleting a report on shared dashboards** | warn "Used on N dashboards — deleting removes it there too"; 30-day trash undo |
| **Editor removed mid-session** | edit permission checked per-mutation, not cached, so a revoked editor can't save |

---

## 7. Enforcement points (where the checks actually live)

1. **Every report query:** `WHERE "orgId" = $session` injected by the compiler — unconditional.
2. **Every mutation route** (save/rename/delete/share/add-to-dashboard): `owner || editor` check.
3. **Every drill-through and export query:** `visibleRecords(viewer, object)` predicate.
4. **Every export and delivery:** audit-log write.
5. **Never trust client config for identity or scope** — `orgId`, viewer id, and visibility come from the session, not the request body.

---

## 8. Testing (see [SPEC-REPORTING-TESTING.md](SPEC-REPORTING-TESTING.md))

- Two-org tenant-isolation sweep across every object + join path.
- Aggregate-includes-but-drill-excludes a restricted record (once record-level visibility exists; today asserts org-boundary).
- Mutation routes reject a non-owner/non-editor.
- Export/subscription obey visibility + write audit rows.
- No client-supplied `orgId`/viewer id is ever honored.

---

## 9. Open decisions

1. **Record-level visibility timing.** v1 ships on `orgId` only; the `visibleRecords` predicate is a **seam** now, filled when the multi-user permissions spec lands. Recommend building the seam in v1 so drill/export route through it from day one. *(Recommend the seam now.)*
2. **Per-report "restricted" aggregate flag.** Recommend **defer** — not needed until an org asks to hide numbers, not just rows. *(Recommend defer.)*
3. **Owner-departure transfer target.** Recommend transfer to an **org admin**; alternative is a configurable "reports owner." *(Recommend admin default.)*
