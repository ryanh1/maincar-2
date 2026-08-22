# Delivery Backlog — Chunk 2 and Chunk 3

**Planning issue:** MAI-282
**Authoritative inputs:** `SPEC-CHUNK-2-views-lists-color.md`,
`SPEC-CHUNK-3-composite-cockpit.md`, the current CRM schema, and the current
Chunk 1 delivery state in Linear.
**Planning boundary:** this document creates additive delivery slices. It does
not revise MAI-175, MAI-179, or another active issue.

## Readiness rules

- MAI-175 and MAI-179 are in review. Under the project's dependency rule,
  review-ready specifications can unblock their follow-up planning; their
  approved contracts remain authoritative.
- MAI-287 is the Chunk 1 settlement/quality gate. Every delivery slice that
  depends on the core grid is explicitly blocked by it.
- `ObjectDef`, `AttributeDef`, `List`, `ListEntry`, `RecordLink`, and
  `ActivityEntry` remain the canonical models. No ticket may create a second
  CRM store, a flattened `CockpitRow`, or persisted composite values.
- Group, board, and selection surfaces remain count-only. A composite
  reduction is an internal scalar for sort/filter/group/colour, never a UI
  aggregate.

## Capability matrix

| Capability and requirements | Owning model / service API | UI surface | Required verification | Source decision | Delivery ticket |
| --- | --- | --- | --- | --- | --- |
| Durable saved configuration; object scope; Personal/Shared authorization; one default; config repair/migration; CRUD | `SavedView`, `SavedViewService`, `can*SavedView` policy seam | Foundation only | schema/service/authorization/default tests | C2 §§1, 4.1, 4.4 | MAI-288 |
| View switching; save/duplicate/delete/reorder; share confirmation; URL overlay precedence; PII-safe copy link; keyboard/focus | Saved-view API plus versioned `ViewStateCodec` | Object header, toolbar, command palette | codec, route, second-member, keyboard browser journeys | C2 §§2.1–2.2, J2.1–J2.2 | MAI-295 |
| Lists; selection membership; list-only fields; filter-fed rules; safe unlink; sparse manual order; dialer order; list sharing | `List`, `ListEntry`, `AttributeDef.storage = "list"`, `ListService` | List route, left rail, selection actions | route/integration isolation, membership, ordering, browser walk | C2 J2.3, §4.2; CRM Schema §5.3 | MAI-285 then MAI-296 |
| Generic Kanban; valid select/status columns; No value; pointer/keyboard moves; history/rollback; count-only headers | `AttributeDef.optionsJson`, normal typed mutation, `FieldHistory`, `KanbanService` | Saved-view Kanban layout | validation, move/history/rollback, keyboard browser journey | C2 J2.4, no-aggregation rule | MAI-297 |
| Muted option colours; relation header auto/manual style; rules; scalar manual paint; export isolation | `AttributeDef.optionsJson`, `SavedView.configJson`, `ColorRule`, `CellStyle`, `ColorService` | Header, Format popover, cell paint | precedence/rule/export tests, accessibility browser walk | C2 J2.5, §4.3 | MAI-298 |
| Renderer go/no-go: 500-row fixture, 60fps, hit map, sub-cursor, editor anchoring, accessibility mirror, repeat repaint; DOM trigger | Prototype only; renderer choice in view presentation config | Canvas fixture or qualifying DOM view | performance capture, keyboard/screen-reader journey, decision record | C3 §6 | MAI-299 |
| Resolver configuration; path/template/reduction validation; typed authorization; visible-window batched reads; `ActivityEntry`; drill-in cursor | Saved-view resolver config, resolver service, root list endpoint, `RecordLink`, `ActivityEntry` | Column configuration and data hooks | unit validation, integration query bounds, 50k fixture | C3 §§4–5 | MAI-300 |
| Read-only horizontal/vertical/combination composites; exact sub-value hit map; overflow; paginated drill-in; repair state | Resolver render tokens; separate drill-in API | Grid cell, drill-in | render/repair tests, activity binding, browser walk | C3 §§3.1–3.2, 8 | MAI-301 |
| Sub-cursor navigation; typed source edit-through; repeat invalidation; add/link picker; clear vs unlink vs archive | Existing typed mutations, relation APIs, `FieldHistory`, resolver invalidation | Composite editors and safe-action confirmation | keyboard/action unit tests, relation integration tests, browser/a11y journey | C3 §§3.3–3.4, 5.2 | MAI-302 |
| Company cockpit; one-hop relation columns; nested-list/fan-out; shared-source cue; reductions; save/share/repair | Saved resolver config, resolver compiler, colour config | Root grid/cockpit configuration | reduction/query tests, 50k browser journey, saved-template checks | C3 §§4–5, 8 | MAI-303 |

## Dependency order

```text
Chunk 1 settlement (MAI-287)
  ├─ Saved-view foundation (MAI-288) ─┬─ View UI / URL (MAI-295)
  │                                  ├─ Kanban (MAI-297)
  │                                  └─ Colour (MAI-298)
  ├─ List route (MAI-285) ───────────── List workflow (MAI-296)
  └─ Composite spike (MAI-299) ─ Resolver reads (MAI-300)
                                          └─ Composite read surface (MAI-301)
                                               └─ Edit-through safety (MAI-302; also MAI-289)
                                                    └─ Cockpit fan-out/reductions (MAI-303)
                                                       (also MAI-295 and MAI-298)
```

MAI-299 is the explicit gate for every subsequent Chunk 3 implementation
slice. It selects the DOM renderer when any documented canvas exit criterion
fails; the data, API, keyboard, safety, and acceptance contracts remain the
same.

## Backlog handling

MAI-176 through MAI-181 were left unchanged. They are earlier, coarse backlog
statements and include a now-obsolete `react-datasheet-grid` fallback. The
new delivery tickets above are the authoritative implementation-sized slices:
they name exact acceptance, verification, likely files, source decisions, and
real Linear dependencies. Nothing in this plan changes an In Progress or In
Review issue.
