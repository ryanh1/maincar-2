# SPEC-CHUNK-3 — Composite Cells & Cockpit Grid

**Status:** build-ready deep spec

**Slice:** S6 (P2)

**Owns:** G9 composite cells; G10 multi-object cockpit grid
**Depends on:** Chunk 1 grid/editing/keyboard spine, Chunk 2 saved views + colour, and CRM Data Schema `ObjectDef` / `AttributeDef` / `ActivityEntry` / `RecordLink`.

## 1. The job and the non-negotiables

A rep can read and edit an account as one row: root Company data alongside People, Activity, Deals, and custom relations. A cell may contain several values, but it is never a second store of those values. It resolves normalized records at read time and writes through to their source record or relation.

This is a keyboard-first CRM surface. The sub-cursor is not decorative: every visible sub-value can be reached, identified, and edited without a mouse. The view must stay fluid over a 50k-company root set by resolving only the current grid window.

### Authoritative constraints

- `DECISIONS.md` wins over all older material. This chunk keeps the Sheets-first grid contract: click selects, `Enter` edits, typing replaces, and `Space`/the row affordance—not `Enter`—opens a record.
- Relation columns use the muted, relation-coloured header system from Chunk 2; colour is never the only cue.
- No aggregation UI is added. A required **reduction** only produces the scalar needed to sort, filter, group, or conditionally colour a multi-value column; it is not shown as a summary statistic.
- Every person-facing time comes from the existing formatted date/time helpers and shows an explicit zone. A cell never invents or renders an unlabelled local time.
- The record schema remains the CRM Data Schema. This chunk adds view configuration only; it does not introduce a flattened `CockpitRow` or a persisted composite value.

## 2. Shared vocabulary

| Term | Meaning |
| --- | --- |
| **Root row** | The normalized record that supplies each grid row, normally a Company in the Account cockpit. |
| **Resolver column** | A view-configured column that follows a relation path from the root and projects one or more source records. |
| **Composite cell** | A resolver cell with multiple independently addressable sub-values. It is horizontal, vertical, or combination shaped. |
| **Sub-row** | One child record rendered inside a vertical or combination cell. |
| **Sub-cursor** | The focused `{subRowIndex, subValueIndex}` within a composite cell. |
| **Reduction** | The explicit scalar selected to make a multi-value column sortable/filterable/groupable: newest, oldest, count, first, sum, max, min, or average when type-compatible. |
| **Drill-in** | The full, paginated related-record list opened by “Show N more”; it does not change the root grid or fabricate an expanded row. |

## 3. What a user can do

### 3.1 Read the three composite shapes

| Shape | Example | Behaviour |
| --- | --- | --- |
| **Horizontal** | `Aug 14 · Connected` | One source record, template fields on one line. A date is a date chip; status/select is a muted status chip with caret only while active; all other fields are text/link text. |
| **Vertical** | `Dana Reeve` / `Omar Reyes` | A sorted list of related records, one source per sub-row. |
| **Combination** | `[Aug 14] · [Connected]` / `[Aug 12] · [Voicemail]` | A vertical list where every sub-row uses a horizontal template. Activity combines configured kinds through the existing `ActivityEntry` feed. |

The configured visible limit controls rendering height, not cardinality. The cell renders its top `N` by column sort and a clear **Show N more** control when more exist. That control opens a drill-in with cursor paging; no value is silently hidden and no fixed child cap exists.

### 3.2 Configure a composite column

**Entry:** a root-grid header’s `+ Add column → From a related object → [path] → Composite`, or `⋯ → Edit column`.

The right-side configuration panel is tab-navigable. It contains, in order:

1. Name and description.
2. One-hop source path (People, Deals, Activity, Parent Company, or a schema-defined custom relation). A second hop is an explicitly labelled advanced option, not the default.
3. Shape: horizontal, vertical, or combination.
4. Source kinds where a combined feed is applicable; Activity maps to `ActivityEntry.sourceType`, never a per-cell union query.
5. Fields or a `{{field}}` template. Invalid/missing or unmapped template references show an inline error and block save.
6. Chip presentation per field: text, date, status/select, or record link. A field must be type-compatible with its selected chip.
7. In-cell child sort, visible limit, and whether the column is nested-list (default) or fan-out.
8. A representative preview, then Save / Cancel. `Esc` cancels without changing the view.

Saved columns are schema-sensitive: display labels may change with `AttributeDef`, but a removed attribute makes the column visibly **Needs repair** rather than returning a plausibly wrong cell. Repair opens the same panel and offers a replacement field; the rest of the view remains usable.

### 3.3 Navigate and edit inside a composite

Entering a composite cell reveals the sub-cursor outline and accessible description, for example: “Activity, row 2 of 5, disposition, Voicemail.” A pointer hit-test targets the exact sub-value; keyboard entry starts at the first visible editable sub-value.

| Input | Grid cell | Composite sub-cursor |
| --- | --- | --- |
| `Enter` | edit the selected cell | enter the cell; then open the focused chip editor or edit the focused text |
| `Esc` | cancel an editor | close editor, then exit the sub-cursor back to the grid cursor |
| `←` / `→` | adjacent grid cell | previous/next sub-value in the current horizontal template |
| `↑` / `↓` | adjacent grid row | previous/next sub-row in vertical/combination shapes |
| `Tab` / `Shift+Tab` | next/previous grid cell | next/previous editable sub-value; at a boundary, leave the cell predictably |
| type | replace selected value | replace the focused editable sub-value only |
| `Delete` / `Backspace` | clear selected value | clear only the focused sub-value; never remove a child record |
| `Cmd/Ctrl+Enter` | — | add a related record or blank permitted child row |
| `Cmd/Ctrl+Delete` | — | remove focused child item; show the safe unlink/archive choice |
| `Cmd/Ctrl+C` | copy display text | copy display text as TSV-safe plain text |
| `Cmd/Ctrl+V` | paste | target the focused editable sub-value only |
| `Cmd/Ctrl+D` | fill down | fill a directly editable sub-value only; never clone links or create child records |

Status editors use the Chunk 1 dropdown command path; date editors use the existing date parser/picker. All reversible source-field edits are optimistic and roll back with an error state if the source write fails. Because all repeated appearances resolve from the same source record, they update together after a successful write.

### 3.4 Add and remove safely

`Cmd/Ctrl+Enter` or the in-cell add affordance opens the existing keyboard `@` picker. The picker searches the allowed related object and can create a blank child only when the relation’s schema/policy permits creation.

There are two intentionally different destructive paths:

- `Delete` / `Backspace`: clear the one focused editable field. It cannot unlink or archive a child.
- `Cmd/Ctrl+Delete` / Remove item: first choice is **Remove from this relation**. It removes the `RecordLink` or core relation and retains the child record. **Archive record** is a separately labelled, confirmation-required action that follows Chunk 4 lifecycle policy. Physical delete is not an S6 action.

The confirm identifies the child and the number of affected links. It defaults to unlink, retains focus predictably, and sends the action through normal history/audit paths.

### 3.5 Copy, paste, and export boundaries

Copy yields the displayed template text, suitable for TSV. Paste may populate the focused direct field, or map newline-separated input to successive already-present, directly editable sub-rows. It does not infer a new Person, relationship, or activity from arbitrary text. Unsupported paste/fill is rejected before mutation with a concise reason.

Grid export defaults to **explode one row per related child** for lossless exports; “join displayed items with delimiter” is an explicit compact, lossy alternative. Export includes only values the viewer is authorized to read.

## 4. Build an account cockpit

The cockpit is a normal saved `GridView`, not a separate application. The user starts from a root-object view (e.g. Companies), adds relation columns, and saves it as a named view or reusable template such as **Account cockpit**.

1. Choose a root object. Root fields stay neutral; related-object columns inherit their object’s stable header colour and text/icon label.
2. In `From a related object`, expose one-hop paths from the root: People, Deals, Activity, Parent Company, and custom `RecordLink` paths. Empty paths render an empty cell, never an error.
3. Pick fields or a template, then configure `{reduce, sort, limit, fanOut}`. Default multi-child behaviour is a nested list; fan-out is an explicit view-level choice.
4. Activity is a resolver over indexed `ActivityEntry` rows filtered by root `companyId` (or the relevant entity identifier). It uses `sourceType`, `summary`, `occurredAt`, and source links; it never runs a Call/Email/Note union per painted cell.
5. When fan-out is on, root values visually grey-merge/repeat. Editing a repeated root cell writes once to the source root and invalidates every visible repeat. The UI marks the value Shared; it does not pretend each display row owns a copy.
6. The root list uses the existing cursor window. Once root rows are known, the resolver batch-loads only those visible/root-buffer ids. Scroll cancellation and cache keys include the view-config revision and root window cursor.

### Multi-value sort, filter, and group

When a user asks to sort, filter, group, or conditionally colour a multi-value resolver, the UI asks **How should we rank this?** once, in plain language. Allowed choices are type-specific:

- date/timestamp: Newest or Oldest;
- list/reference: Count or First;
- numeric: Sum, Max, Min, or Average.

The selected `reduce` persists with the column config and becomes the server-side scalar expression for that operation. It is required before request submission; no implicit “first child” default is allowed. D6 still applies: the result is not displayed as a group or selection aggregation.

## 5. Data and server contract

### 5.1 Persisted configuration only

`GridView.columnsJson` owns this shape. The exact Prisma field/model is resolved with the Schema project at implementation time; no source record model changes are in scope.

```ts
type ResolverColumn = {
  id: string;
  kind: "root" | "relation" | "activity" | "composite";
  path: { fromObject: string; relation: string; toObject: string }[];
  fields?: string[];
  template?: string; // {{attributeSlug}}
  shape?: "horizontal" | "vertical" | "combination";
  chips?: Array<{ field: string; presentation: "text" | "date" | "status" | "link" }>;
  sourceTypes?: string[]; // ActivityEntry.sourceType allow-list
  sort?: { field: string; direction: "asc" | "desc"; nulls: "last" };
  limit?: number;
  fanOut?: boolean;
  reduce?: { field?: string; op: "newest" | "oldest" | "count" | "first" | "sum" | "max" | "min" | "avg" };
  presentation?: { overflow: "show-more"; headerColor?: "auto" | string };
};
```

- Config references stable `ObjectDef`/`AttributeDef` ids or stable slugs with a migration policy; it never serializes display-only labels as an identifier.
- `RecordLink` powers custom-object and note/task links; core model relationships keep their real foreign keys.
- `ActivityEntry` is the canonical activity read model. Any new activity kind is a new `sourceType`, not a new resolver query.
- Server validates that every requested path, field, reduction, and write is authorized and type-compatible. It returns structured repair errors rather than executing dynamic identifiers supplied by the client.

### 5.2 Read/write execution

1. The existing list endpoint resolves root ids, count, filter, sort, and cursor window server-side.
2. A batched resolver receives root ids plus validated view config. It preloads one-hop core relations or `RecordLink` in bounded batches, and `ActivityEntry` by indexed parent ids.
3. It applies child sort/limit and returns source ids, source versions, and render tokens—not flattened durable rows.
4. A sub-value write calls the existing typed field/relation mutation for that source id. The response invalidates all resolver cache entries containing the source or its relationship and records normal `FieldHistory` where applicable.
5. A drill-in has its own cursor endpoint and never causes all children to load into the grid window.

## 6. Canvas feasibility and rendering decision

Glide Data Grid is viable for the primary implementation: its custom cell renderers draw arbitrary canvas content, accept cell bounds/hover coordinates, and provide custom editors. That makes dense static chips, lists, relation colour, pointer hit-testing, sub-cursor rendering, and overlay-editor placement feasible. It does **not** supply a composite interaction model; focus state, exact sub-cell hit maps, keyboard routing, menu anchoring, and accessibility semantics are our implementation responsibility.

| Option | Strength | Cost / risk | Decision |
| --- | --- | --- | --- |
| Glide canvas for every grid | Matches the Sheets-first feel and handles large windows efficiently. | Highest custom-interaction and a11y burden for nested editors. | **Primary.** Prove with an interaction spike before S6 implementation. |
| DOM only for every grid | Native controls make sub-cells easier. | Replaces a proven high-density, high-row-count substrate unnecessarily. | Reject. |
| Glide default, DOM for qualifying composite cockpit views | Keeps basic grids fast while making dense interactive composites conventional DOM. | Two renderers must share config, selection, writes, and test contract. | **Approved fallback**; it is a renderer swap, not a data-model fork. |

### Exit criteria for the canvas spike

Use Glide when one 500-row composite fixture can, at 60fps on supported desktop hardware:

- hit-test and focus a chip in every shape at correct zoom/density;
- route the full sub-cursor table without focus loss;
- position a status/date/editor overlay over its exact visual sub-value through scroll and resize;
- expose focused sub-value semantics to screen readers through a maintained DOM accessibility mirror; and
- update all repeated occurrences after one source write without stale paint.

Use the DOM renderer for that view when any criterion remains unsatisfied after the bounded spike, or when its rendered cell density exceeds the documented canvas interaction limit. The switch is persisted only as `renderer: "canvas" | "dom"` in view presentation config; column resolver data, server APIs, keyboard commands, safe-delete semantics, and acceptance suite remain identical. This is the already-decided fallback, not an invitation to silently degrade behaviour.

## 7. Benchmark findings and patterns to borrow

| Product | Confirmed pattern | Borrow / avoid |
| --- | --- | --- |
| [Airtable linked records](https://support.airtable.com/collections/6304390587-linked-record-field) | Mainstream linked-record baseline; relationship management is a distinct field interaction. | Borrow quick add/link and a clear unlink-vs-record lifecycle distinction; do not treat a chip removal as destruction. |
| [Notion relations](https://www.notion.com/help/relations-and-rollups) | Relation values open related pages and can be removed with a hover minus; a relation may be one-way/two-way and limited to one or unlimited pages. | Borrow explicit relation removal and custom displayed related properties; do not use Notion’s multi-step interaction as the keyboard bar. |
| [SmartSuite linked records](https://help.smartsuite.com/en/articles/4604028-linked-record-field) | Linked-record configuration includes a record picker, field/sort/filter controls, and a Sub-items mode that creates children instead of selecting existing records. | Borrow the explicit “link existing vs create child” mode; preserve our single keyboard picker. |
| [Clay cell data](https://university.clay.com/docs/manage-cell-data) | Rich/enrichment output is a structured list in one cell, inspected in a details panel. | Borrow expanded-cell list actions and inspectability; avoid making the panel the only editing path. |
| [Baserow link-to-table](https://baserow.io/user-docs/link-to-table-field) | Cell `+` opens a selectable record list; selected rows appear as tokens; token `x` unlinks; picker can create a row and expose useful fields. | Borrow token affordance, create-in-picker, and contextual picker fields. |
| [NocoDB Link to Another Record](https://nocodb.com/docs/product/tables/fields/field-types/links-based/link-to-another-record) | Chips expand to cards with search, count, link/unlink, link-more, and create-new actions; custom display value can be chosen. | Borrow count/overflow drill-in, card picker, custom display field; replace mouse-only card actions with commands. |
| [Sigma pivot tables](https://help.sigmacomputing.com/docs/working-with-pivot-tables) | Repeat row labels visually reveal shared grouped values. | Borrow the readability cue for fan-out parents, plus a clear Shared marker; do not imply duplicated storage. |
| [Rows](https://rows.com/docs/gs-spreadsheet-basics) | Spreadsheet-oriented scalar cells are a useful counterexample. | Keep rich composite behaviour restricted to explicit resolver columns, not ordinary scalar fields. |
| [Glide Data Grid custom cells](https://docs.grid.glideapps.com/api/dataeditor/custom-cells) | Custom renderers own drawing and editor logic; draw callbacks expose bounds, hover state, and canvas context. | Use as the canvas substrate, but treat nested hit-testing/accessibility/editor lifecycle as custom work with a tested DOM fallback. |

**Recommendation:** combine the safest interaction ideas: compact Baserow/NocoDB-style tokens and picker/drill-in; Notion-style explicit unlink; SmartSuite-style create-vs-link clarity; Sigma’s shared-parent cue; and Clay’s expanded-cell inspection. Our differentiator is what none of these jointly provides: keyboard-addressable sub-values, source edit-through, a safe destructive split, and one-row account stitching.

## 8. Acceptance criteria

### Composite interaction

- [ ] Horizontal, vertical, and combination composites render only from source records and show the configured chip/text presentation.
- [ ] Keyboard traversal exactly follows the table in §3.3; `Esc` can always exit and focus never becomes trapped.
- [ ] Pointer selection maps to the exact visible sub-value at all supported zooms and row heights.
- [ ] A chip edit writes to its source record, shows optimistic reversible state, rolls back on a failed write, and refreshes every repeat.
- [ ] `Delete` cannot remove a related child; `Cmd/Ctrl+Delete` defaults to unlink and archive requires a separate confirmation.
- [ ] Add/search/create flow is keyboard-complete and respects relation permissions.
- [ ] Invalid template refs, deleted attributes, and unsupported paste/fill show actionable errors and cannot silently corrupt data.
- [ ] `Show N more` opens a paginated drill-in; a high-cardinality relation does not expand grid row height unboundedly.

### Cockpit and performance

- [ ] A Company cockpit adds one-hop Person, Deal, Activity, Parent, and custom-relation columns without hard-coded field names.
- [ ] Activity resolves through `ActivityEntry`, matching the record page, with no per-cell union query.
- [ ] Nested-list is default; fan-out is explicit; shared parent cells visibly indicate a shared source and update consistently.
- [ ] Choosing sort/filter/group on a multi-value column requires one type-compatible reduction and persists it; no aggregate summary is added to the UI.
- [ ] Resolver work is bounded to the visible root window/buffer; a seeded 50k-company view maintains the agreed interaction performance target without fetching all related records.
- [ ] Canvas spike exit criteria in §6 are measured and recorded. If it fails, the selected view uses the DOM renderer without contract differences.

### Quality and accessibility

- [ ] Unit tests cover resolver-config validation, reductions, template repairs, relation path authorization, and destructive-action routing.
- [ ] Integration tests cover batched window resolution, `ActivityEntry` binding, source edit-through/repeat invalidation, unlink versus archive, and high-cardinality drill-in pagination.
- [ ] Browser coverage walks all three shapes by keyboard, add/edit/delete safety, DOM fallback parity if selected, and an account cockpit at realistic density.
- [ ] Screen-reader accessible focus announcements identify the column, sub-row, sub-value, editable state, and command hint.

## 9. Implementation order and boundaries

1. Implement/measure the Glide composite interaction spike and define shared renderer contract.
2. Add validated resolver configuration + batched read contract, first for one-hop People and Activity.
3. Implement read-only three shapes, overflow/drill-in, and relation-colour headers.
4. Add sub-cursor, source edit-through, picker, and safe unlink/archive decision.
5. Add fan-out/repeated parent model, reduction picker, server sort/filter/group compilation, and template save/share integration.
6. Apply the DOM fallback only if the documented spike says it is required; then run the same journey suite.

**In scope:** view configuration, resolver reads, cell rendering/interactions, and source writes through already-owned record/relation APIs.

**Out of scope:** record lifecycle implementation (Chunk 4 owns archive/delete semantics), new record storage, arbitrary deep graph joins, formula/rollup UI, aggregation summaries, AI/enrichment columns, and a general-purpose spreadsheet renderer.

## 10. Source trail

- Internal authority: `CHUNK-3-composite-cockpit.md`, `DECISIONS.md`, `SPEC-CRM-SCHEMA.md`, v1 journeys `4f-crm-composite-cells`, `4b.1`, `4b.1a`, `4b.14`, and `4a-crm-relations-and-related-records`.
- Product research was checked on 2026-08-21 against the linked official documentation in §7. Interaction details not documented by vendors are deliberately not asserted as fact; the implementation spike and browser journey tests are the verification point.
