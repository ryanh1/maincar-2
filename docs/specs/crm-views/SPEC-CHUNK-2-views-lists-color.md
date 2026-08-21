# SPEC — Chunk 2: Views, Lists, Kanban & Colour

**Status:** implementation specification
**Slice:** S5 — save, switch, list, colour
**Scope:** saved views, lists, Kanban, sharing, URL state, and view-scoped colour
**Authoritative decisions:** `DECISIONS.md` wins over the earlier overview and v1 journeys.

## 1. Purpose and non-negotiables

Chunk 2 lets a rep shape an object grid into a reusable working surface: save
an arrangement, switch it quickly, share it with the workspace, build a
process-specific list, use a Kanban board, and add calm visual structure. It
extends the Chunk 1 grid; it never adds a second record store or a parallel
filter model.

The following constraints apply to every journey in this spec.

- **Schema-driven:** objects, fields, select options, and relations come from
  `ObjectDef` and `AttributeDef`; no People-, Deals-, or pipeline-specific
  columns are hard-coded.
- **Keyboard-first:** every action has a keyboard path, a visible shortcut
  where it helps discovery, predictable focus return, and `Esc` dismissal.
- **One view model:** the header menus and Chunk 1 toolbar edit the same live
  `ViewConfig`; saving persists that state as `SavedView.configJson`.
- **Formatting is presentation, not record data:** view configuration, colour
  rules, and painted cells do not alter a canonical record or an export.
- **No aggregation anywhere:** group sections and Kanban headers show counts
  only. Do not render sum, average, weighted value, or a bottom summary bar.
- **Workspace sharing is authenticated discovery, not a public link:** a
  shared item appears in members' switchers; a URL never bypasses access.

### Decisions resolved by this spec

| Question | Decision |
| --- | --- |
| Persisted view vs. sharable arrangement | Do both. A saved view is named persisted config; URL state is an optional session overlay. |
| URL precedence | Parse the saved view first, then apply valid URL state. URL wins for that session only; **Save changes** persists the merged result. |
| List model | Reuse CRM Schema `List` and `ListEntry`; do not introduce the overview's competing `ListEntity` model. |
| Shared-view edits | Any member may edit in this release after a clear confirmation. Put authorization behind a `canEditSharedView` policy seam so a later role rule can narrow it without changing UI contracts. |
| Kanban totals | Counts only. Earlier `count · Σ amount` and weighted-total language is superseded by `DECISIONS.md` D6. Forecasting belongs to its dedicated surface. |
| Manual cell paint scope | Per view only; never leak to another view, an export, API data, or a record page. |

## 2. Shared vocabulary and contracts

### 2.1 Live view state

`ViewConfig` is the typed client/server contract behind the existing grid
toolbar, header controls, and saved views. Unknown fields must be ignored on
read and preserved only when the current schema can safely round-trip them.

```ts
type ViewLayout = "list" | "grid" | "kanban";

type ViewConfig = {
  columns: Array<{ attributeId: string; visible: boolean; order: number }>;
  sorts: Array<{ attributeId: string; direction: "asc" | "desc" }>;
  filterTree?: FilterGroup;
  groupBy?: Array<{ attributeId: string; direction: "asc" | "desc" }>;
  rowHeight: "compact" | "comfortable" | "tall";
  gridLines: boolean;
  frozenRows: number;
  frozenCols: number;
  zoom: number;
  columnWidths: Record<string, number>;
  columnStyles: Array<ColumnStyle>;
  changeHighlight?: { on: boolean; days: number; onlyChanged?: boolean };
  kanban?: {
    groupAttributeId: string;
    visibleOptionValues: string[];
    cardAttributeIds: string[];
    hiddenTerminalOptionValues?: string[];
  };
};

type ColumnStyle = {
  attributeId: string;
  headerColor?: MutedColorToken;
  auto?: { kind: "relation-source"; objectId: string };
};
```

`SavedView.layout` is separate from `configJson` so that switching between a
list/grid/board is cheap and queryable. A view owns exactly one root object.
`attributeId`s are durable IDs, never labels or user-editable slugs.

### 2.2 URL state

The route identifies the object and optional saved view:

```text
/crm/:objectSlug?view=:savedViewId&v=:encodedLiveConfig
```

`v` contains an encoded, versioned, allow-listed subset of live display state:
visible column IDs and order, sorts, filter operators and field IDs, group IDs,
layout, row-density/display settings, and a schema version. It must not contain
record values, free-text search terms, filter literal values, names, email
addresses, phone numbers, or any other PII. Filters requiring a literal remain
in local session state unless they are saved to a server-side view accessible to
the recipient.

On load:

1. Authorize the object and, if present, the saved view.
2. Start from the saved view's config, or the system default for the object.
3. Decode and validate `v` against visible `AttributeDef` IDs and permitted
   operators; discard invalid, stale, or unauthorized fragments.
4. Apply valid URL fields as a non-persistent overlay and display an
   **Unsaved changes** indicator when it differs from the persisted view.
5. On **Reset**, discard only the overlay. On **Save changes**, persist the
   merged config after the shared-view warning when applicable.

Copy-link preserves the non-sensitive overlay. Share controls do not silently
change the saved view's visibility.

## 3. Journeys

### J2.1 — Save, switch, and manage an object view

**User goal:** “I can reopen the exact way I work and switch without menu
hunting.”

**Benchmark (beat this):** [Airtable's view configuration](https://support.airtable.com/docs/creating-and-configuring-views-in-airtable)
and [Attio views](https://attio.com/help/reference/managing-your-data/views).

**Entry points**

- Object header: named view switcher; current view has an adjacent `…` menu.
- Command palette: search by object name, saved-view name, and list name.
- Keyboard: `Cmd/Ctrl+K` reaches any saved view. The switcher exposes a
  discoverable quick-switch binding once the command palette's final key map
  is assigned; it must not reserve a bare destructive key.

**Flow**

1. A rep changes the grid's fields, sort, filter, group, density, or layout.
   The live state changes once; both the toolbar and header surface reflect it.
2. **Save as new view** asks for a name and starts **Personal**. It stores the
   current arrangement exactly, then focuses the new switcher item.
3. Selecting a view applies its object-scoped configuration without replacing
   the route's valid URL overlay. The switcher identifies the active view and
   whether it has unsaved changes.
4. The `…` menu supports inline rename, **Save changes**, Reset, Duplicate,
   sharing, Set default, Reorder, and Delete. Menu actions are arrow-key
   navigable; Enter confirms; Esc returns focus to the switcher.
5. **Duplicate** creates “`<name> copy`” with copied configuration but Personal
   visibility and no default flag.
6. **Set default** is atomic: the system default is always present until a user
   replaces it, and exactly one default applies for an object and audience.
7. **Delete** removes configuration only, shows an undo toast, and is disabled
   for the active default until another default is selected. It never mutates
   rows, list membership, records, or attributes.

**Layouts**

| Layout | Default display | Intent |
| --- | --- | --- |
| `list` | grid lines off | calm scanning and operational work |
| `grid` | grid lines on | explicit spreadsheet mode |
| `kanban` | board columns by a selected status/select field | progression through a process |

**Acceptance**

- [ ] Saving and reopening yields the same visible fields, ordering, filters,
  grouping, density, frozen columns, widths, colours, and layout.
- [ ] A command-palette selection changes the view without requiring a mouse.
- [ ] Duplicate never changes the source or its visibility.
- [ ] Deleting a view cannot delete CRM data and offers undo.
- [ ] A shared-view Save explicitly says that workspace members will see the
  changed configuration.

### J2.2 — Share a view without creating a public surface

**User goal:** “I can make a useful view discoverable to teammates without
email noise or a public data link.”

**Benchmark (learn from, do not copy wholesale):** Attio's
[list access model](https://attio.com/help/reference/managing-your-data/lists/lists-access)
and [Notion's saved-for-everyone distinction](https://www.notion.com/help/views-filters-and-sorts).

**Flow**

1. A Personal view's menu contains **Share with workspace**; the inverse action
   is **Make personal**.
2. Sharing confirms: “Members of this workspace can find this in this object's
   view switcher. This does not create a public link.”
3. A Shared view appears in each authorized member's switcher on next refresh.
   Do not send email, chat, or a notification. A future “new view” marker is
   explicitly out of scope.
4. Turning it Personal immediately removes it from other members' switchers;
   their bookmarked route fails authorization gracefully and falls back to the
   object default with a brief explanation.

**Policy seam**

All mutations call `canViewSavedView`, `canEditSavedView`, and
`canShareSavedView`. The first release can return workspace-member access, but
the services must be the only authorization boundary so later roles/admin-only
shared edits do not require a URL or component rewrite.

**Acceptance**

- [ ] New views are Personal by default.
- [ ] A non-member cannot open a shared view by guessing or receiving its URL.
- [ ] Sharing changes visibility in the switcher, not record permissions.
- [ ] The UI never claims that a notification was sent.

### J2.3 — Make a list that carries process context

**User goal:** “I can build a calling or target list whose order and extra
fields do not corrupt the underlying records.”

**Benchmark (beat this):** [Attio's list-entry model](https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists).
Attio demonstrates the important distinction: list attributes belong to an
entry, while object attributes remain canonical on the record.

**Flow**

1. From an object, choose **New list**, or select rows and choose **Add to
   list**. The object is fixed on creation; selection can add to an existing
   compatible list.
2. The list appears in the left rail's **Lists** section and opens with the
   same keyboard-capable grid shell.
3. **Add list field** creates an `AttributeDef` scoped to `storage: "list"`.
   Values are read and written only in `ListEntry.valuesJson`.
4. Remove member unlinks the entry after confirmation; it never deletes or
   archives the target record.
5. Dragging reorders members only when no sort is active. With a sort, disable
   row drag and explain “Clear sort to reorder by hand.” Persist the order in
   `ListEntry.position`, never in the row's display index.
6. A People list's manual order is the dialer's sole call order. The dialer
   consumes the list entries; it creates no second call-list store.
7. Lists use the same Personal/Shared visibility semantics and policy seam as
   views. The list owner can duplicate a list only in a follow-on slice; that
   operation is out of scope here.

**List membership rules**

- One `List` is constrained to one `objectSlug`.
- The current schema's unique `(listId, objectSlug, targetId)` allows a record
  once per list. Do not silently alter that uniqueness contract.
- Filter-fed lists store their membership source/configuration explicitly; the
  filtered query is evaluated server-side and does not materialize all IDs in
  the browser.
- A hand-picked list persists entries and positions. A filter-fed list may show
  a manual order only after it is converted to a hand-picked list; otherwise a
  sort/filter definition remains the source of membership order.

**Acceptance**

- [ ] A list-only Priority field changes only its `ListEntry` value.
- [ ] Removing an entry leaves the object record intact.
- [ ] The dialer reads People-list order from `ListEntry.position`.
- [ ] A selection banner makes “loaded rows” and “all N filtered rows” distinct
  before adding members.

### J2.4 — Work a Kanban board without turning it into reporting

**User goal:** “I can see work by stage and move cards safely, while the board
stays focused on process rather than spreadsheet totals.”

**Benchmark (beat this):** [Attio Kanban views](https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views).
Attio validates useful mechanics—status grouping, configurable attributes,
stage visibility, and multi-card moves—but this product intentionally rejects
its calculations in favor of count-only headers.

**Flow**

1. Switch a compatible view to Kanban. Choose a `select` or `status`
   `AttributeDef`; Deals default to pipeline stage when it is available.
2. Each non-archived option renders in its configured `order` and `color`.
   Values missing the grouping field render in a **No value** column.
3. A card shows its title plus selected fields. Start with title plus roughly
   three fields; allow more, but warn after five that the card is becoming
   noisy. Missing fields do not reserve blank space.
4. The column header shows **`N records` only**. It never displays money,
   weighted values, averages, or any Σ notation.
5. Dragging a card to another column performs the normal typed-field edit,
   writes `FieldHistory`, updates optimistic UI, and rolls back on error. The
   keyboard equivalent opens a move-to-stage picker from the focused card;
   the picker is type-ahead, Enter commits, and Esc cancels.
6. Multi-select and multi-card move reuse Chunk 1 selection semantics. The
   confirmation names the field and target option when the move changes more
   than one card.
7. Terminal Won/Lost stages are collapsed by default and may be date-bounded
   by the dedicated Deal Board. Chunk 2 owns generic board mechanics only; it
   does not calculate forecast totals or invent deal-warning rules.

**Acceptance**

- [ ] Changing the group field reconfigures columns only from valid option
  metadata; it does not create fields implicitly.
- [ ] Moving a card changes the underlying field exactly once and leaves an
  auditable field-history entry.
- [ ] Empty values go to No value rather than disappearing.
- [ ] Every header is count-only, including terminal columns.
- [ ] A keyboard user can select and move a card without a pointer.

### J2.5 — Apply colour as readable, view-scoped guidance

**User goal:** “The grid is calmer and faster to scan, but colour never becomes
hidden data or the only way I understand a state.”

**Benchmarks:** [Notion conditional colour](https://www.notion.com/help/database-properties)
shows that colour rules can be view-specific; [Google Sheets conditional
formatting](https://support.google.com/docs/answer/78413) is the rule-builder
interaction to match; [Airtable conditional colours](https://support.airtable.com/docs/using-conditional-colors-in-a-grid-view)
is the grid-surface reference.

#### A. Muted palette and select/status options (MVP)

- Select/status options use `{ value, label, color, order, archived }` in
  `AttributeDef.optionsJson`. `value` is the stable stored/exported key;
  `label` is display text.
- New options receive the next curated muted colour automatically. Editing a
  swatch changes every chip/board column that displays that option.
- Relabeling is safe. Changing the stored value requires a record-count warning
  and an atomic migration; archiving hides an option from new choice while
  preserving its rendering on historic rows.
- All chips include text and, where applicable, an icon/shape treatment; their
  hue is never the sole status signal.

#### B. Relation-aware column headers (MVP)

Each header may render a faint tint, a 2px accent, and a text label/group name.
For a relation column, the default is the source object's stable muted hue;
the root object's columns remain neutral. A view owner can set a manual token
or clear it. Manual overrides automatic source tint.

The resolved style is computed as:

```text
manual ColumnStyle.headerColor
  → relation-source automatic hue
  → neutral object-grid header
```

Header styles are stored in `ViewConfig.columnStyles`, scoped to one view.
They are not written to `AttributeDef` and do not alter another view's header.

#### C. Conditional rules (P2)

A Format popover and per-column shortcut create ordered `ColorRule` rows.
Each rule includes attribute, typed predicate, target (`background`, `text`, or
`dot`), colour token, `scope` (`cell` or `subvalue`), enabled state, and sort
order. First matching enabled rule wins. For composite values, whole-cell rules
use the same stored reduction selected for sorting; per-subvalue rules colour
only the matching subvalue.

Seed an editable due-date temperature rule (overdue/red, today/amber,
upcoming/green). A user may turn it off, edit it, or restore it. Seeding is
idempotent and never overwrites edits.

#### D. Manual cell paint (P2)

Paint is available only on stored scalar cells. A `CellStyle` row keyed by
`(viewId, recordId, fieldId)` stores background/text tokens. It is excluded
from CSV/TSV exports and absent in every other view. Composite painting belongs
to Chunk 3 at subvalue granularity.

**Acceptance**

- [ ] A relation column gets its stable automatic header tint.
- [ ] Manual header colour wins over automatic tint and Clear restores it.
- [ ] Rules are ordered, editable, restorable, and view-scoped.
- [ ] A painted cell is plain in another view and in export.
- [ ] Every colour treatment remains understandable in monochrome or for a
  colour-vision deficiency because text, icon/accent, and context remain.

## 4. Persistence and service boundaries

This slice adds configuration and membership behavior only. It does not create
denormalized CRM rows or alter base record storage.

### 4.1 Saved views

Use the existing planned `SavedView` shape, refined as follows:

```prisma
model SavedView {
  id        String @id @default(cuid())
  workspaceId String
  objectId  String
  name      String
  layout    String // list | grid | kanban
  configJson Json
  ownerId   String
  isShared  Boolean @default(false)
  isDefault Boolean @default(false)
  sortOrder Int @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([workspaceId, objectId, sortOrder])
  @@index([workspaceId, objectId, isShared])
}
```

Enforce “one default” transactionally in the service, scoped to the object and
the applicable visibility audience. The system default must be a recoverable
fallback rather than a deletable data row.

### 4.2 Lists and list entries

The CRM schema already defines `List` and `ListEntry`. Extend that existing
model only with the visibility fields and indexes required by this slice; do
not create `ListEntity` or duplicate `ListEntry`.

```prisma
// Add to existing List
isShared Boolean @default(false)
sortOrder Int @default(0)
@@index([orgId, objectSlug, isShared, sortOrder])
```

`AttributeDef.storage = "list"` describes `ListEntry.valuesJson`. Each list
field must be constrained to the list's object context and run through the
same typed validation/formatting as a record attribute. `position` supports
manual order; use a stable sparse-ranking/rebalancing implementation so one
move does not rewrite every entry.

### 4.3 Colour configuration

- `AttributeDef.optionsJson`: global typed-option presentation and order.
- `SavedView.configJson.columnStyles`: per-view column/header presentation.
- `ColorRule`: ordered, view-scoped conditional formatting.
- `CellStyle`: display-only, view-scoped manual scalar-cell paint.

### 4.4 Required service contracts

| Service | Responsibilities |
| --- | --- |
| `SavedViewService` | validate config against schema, authorize, CRUD, default transaction, reorder, share/unshare |
| `ViewStateCodec` | version, allow-list, encode/decode, strip PII and stale IDs |
| `ListService` | compatible membership, list-field CRUD, manual order, filter-fed membership definition |
| `KanbanService` | validate group field/options, field-history-backed moves, multi-move transaction semantics |
| `ColorService` | palette tokens, option colour changes, first-match rule evaluation, export exclusion |

## 5. Explicit boundaries

### In scope

- Saved object views; Personal/Shared workspace discovery; URL display-state
  overlay; list membership and list-only fields; generic Kanban; the muted
  palette; relation header colour; conditional rules and manual paint as P2.

### Not in scope

- Public or anonymous share links, emails/notifications, complete role UI, or
  per-recipient view variants.
- Aggregations, forecast totals, pipeline-weighted values, or a Kanban summary
  bar.
- New record storage, hard-coded CRM fields, custom object schema editing, and
  record lifecycle actions.
- Composite-cell paint/reduction interaction beyond the contract described for
  Chunk 3.
- New browser mockups in this repository. The existing approved artifact is
  the visual reference; the view switcher, share control, list-only field,
  colour/header picker, and Format panel must be refreshed and walked in the
  visual-design session before UI implementation begins.

## 6. Delivery checklist

- [ ] View switcher and all `…` actions are keyboard-complete and accessible.
- [ ] Saved configs and URLs are schema-validated and cannot expose PII.
- [ ] Personal/Shared applies consistently to views and lists.
- [ ] `List`/`ListEntry` is the sole membership model and People-list order is
  the dialer's source of truth.
- [ ] Kanban records count only; no aggregation regresses into the UI.
- [ ] Option, header, rule, and painted-cell colours have the documented scope.
- [ ] Implementation tests cover access, default uniqueness, URL precedence,
  list isolation, move rollback/history, and export isolation.
- [ ] UI implementation includes browser verification of switching, sharing,
  list membership, keyboard card move, and colour accessibility.

## 7. Evidence consulted

- Project authority: `docs/specs/crm-views/DECISIONS.md`, especially D1, D6,
  and D8; Chunk 2 brief; CRM Schema `List`, `ListEntry`, and `AttributeDef`.
- [Attio — understanding lists](https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists)
- [Attio — Kanban views](https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views)
- [Attio — list access](https://attio.com/help/reference/managing-your-data/lists/lists-access)
- [Airtable — configuring views](https://support.airtable.com/docs/creating-and-configuring-views-in-airtable)
- [Airtable — conditional colours](https://support.airtable.com/docs/using-conditional-colors-in-a-grid-view)
- [Google Sheets — conditional formatting](https://support.google.com/docs/answer/78413)
- [Notion — database properties and conditional colour](https://www.notion.com/help/database-properties)
