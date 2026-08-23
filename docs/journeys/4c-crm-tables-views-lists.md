# Doc 4c — Tables, Views & Lists

Part of the **CRM Data & Views** family (split from the old doc 4 so each part stays short):

- **[4 — Objects, Fields & Schema](4-crm-data-and-views.md)** — objects, field types, references, rules, history, standard objects.
- **[4a — Relations & Related Records](4a-crm-relations-and-related-records.md)** — the "show me the whole Acme picture" UX.
- **[4b — Grid View: Power Editing & Keyboard](4b-power-views-editing-and-keyboard.md)** — multi-object grid, Sheets-grade editing, column groups, keyboard.
- **[4f — Composite Cells](4f-crm-composite-cells.md)** — cells with several values/chips (date + disposition, stacked people).
- **[4g — AI Columns](4g-crm-ai-columns.md)** — columns whose cells run an AI instruction.
- **4c — Tables, Views & Lists** *(this doc)* — the grid, view setup (columns/filter/sort/group), saved views + kanban, lists. **Journeys 4.7–4.10.**
- **[4d — Records, Notes, Tasks & Mentions](4d-crm-records-notes-tasks.md)** — Journeys 4.11, 4.13–4.15.
- **[4e — Search, Notifications & Attention](4e-crm-search-notifications-attention.md)** — Journeys 4.12, 4.16–4.18.

**Journey numbers are stable across the split** — 4.7 is still 4.7, just in this file — so cross-references from other docs still resolve.

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the page that tells the coding agent how to build it. The engineering, schema, and decisions for this doc are at the **bottom** (Background jobs · Decisions · Data model · Technical decisions · **§A — Spreadsheet-grade table**).

---

## Journey 4.7 — Browse an object as a table (must feel like Google Sheets)

*As a rep, I want to browse an object's records in a fast, spreadsheet-like grid, so that I can scan, sort, and edit hundreds of records without ever waiting.*

This table is used all day. It must feel **as fast and fluid as Google Sheets, even with tens of thousands of rows.** The full interaction spec + the library choice are in **§A — Spreadsheet-grade table** at the bottom; the essentials:

1. He clicks an object (e.g. People) → a spreadsheet-style grid.
2. **Selection & navigation, Sheets-style:** click a cell (crisp active-cell outline); arrow keys move; `Tab`/`Enter` advance; `Shift+Arrow` extends a range; click a column header to select the column; `Cmd/Ctrl+A` selects all.
3. **Editing, Sheets-style:** type to overwrite; `F2`/double-click to edit in place; `Esc` cancels, `Enter` commits; paste a multi-cell block from Excel/Sheets; multi-step undo/redo. (Exact cursor rules: doc 4b.2.)
4. **Structure — resize/reorder columns, and freeze rows *and* columns like Google Sheets.** Beyond a frozen header row and a frozen leading column, the rep can **freeze any number of leading rows and any number of leading columns**, exactly like Sheets:
   - A **freeze line** (a slightly heavier gridline) sits at the current freeze boundary. He **drags that line** left/right to freeze N columns, or up/down to freeze N rows — the frozen band stays put while the rest scrolls.
   - The same is available from a menu: **column header ⋯ → Freeze up to this column**, **row ⋯ → Freeze up to this row**, and **Unfreeze** (or drag the line back to zero). Freezing is **per view** and remembered.
   - This matters for the wide multi-object grids (doc 4b.1): freeze the Company columns on the left and a header band on top so the account stays visible while scanning activity to the right.
5. **In-cell rendering:** select fields render as **colored chips**, booleans as **checkboxes** (the Airtable-style structure).
6. **Long cell content — click to expand, like Sheets.** By default a cell **clips** overflow to one line with an ellipsis. Clicking (selecting) a cell that has more content shows the **full value in an expansion overlay** — a small popover that grows past the cell bounds to show the whole text, so a long note or address is readable without widening the column or opening the record. `Esc` or moving off the cell closes it. (Wrapping vs clipping is the rep's choice — Journey 4.8.6.)
7. He clicks **New** to add a record, or a row to open the record (Journey 4.11).
8. **Deals special case:** the Deals object has a pipeline-stage field; in settings he can CRUD the stages (name, order, color). (`PipelineStage` schema lives in doc 4.)

- **Benchmark (beat this) — split by aspect:**
  - **Google Sheets — the *editing & motion feel*:** cursor/selection rules, type-to-edit, multi-cell copy/paste, undo/redo, the **freeze-line drag**, and the **click-to-expand overflow overlay**. When behavior of *the grid as a spreadsheet* is in question, Sheets is the bar (exact rules pinned in doc 4b.2). — https://support.google.com/docs/answer/181110
  - **Airtable — the *CRM-grid structure*:** field **types**, in-cell **chips/checkboxes**, **grouping**, **filtering**, and **saved views** (Journeys 4.8–4.9). When behavior of *a database presented as a grid* is in question, Airtable is the bar. — https://support.airtable.com/docs/getting-started-with-a-grid-view
- **Build docs:** Glide Data Grid (canvas grid, MIT) — https://github.com/glideapps/glide-data-grid (chosen in §A); freeze rows/cols via Glide `freezeColumns` + a frozen-rows layer.

## Journey 4.8 — Set up a table view

*As a rep, I want to shape the table — pick which columns show, sort, filter, group, and control how text displays — so that I see exactly the records and fields I care about and nothing else.*

You asked me to break this out, because "set up a view" was really five separate things with five different bits of UI. **All five live on one place: a horizontal `view toolbar` above the grid**, with buttons **Fields · Filter · Sort · Group · Row height** (Airtable's view-toolbar model). Each button opens a small popover. The sub-journeys below are those five, each with its own UI.

### Journey 4.8.1 — Choose which columns show (and their order)

1. He clicks **Fields** in the view toolbar → a popover lists **every field on the object**, each with a **visibility toggle** and a **drag handle**.
2. He **toggles a field off** to hide its column (the data is untouched — hidden, not deleted) and **on** to show it.
3. He **drags a field** in the popover (or drags the column header in the grid) to reorder columns. **Hide all / Show all** shortcuts sit at the top.
4. The chosen columns + order are saved on the view (Journey 4.9).

- **Benchmark (beat this):** Airtable — hide fields / field visibility — https://support.airtable.com/docs/hiding-fields-in-airtable
- **Build docs:** internal — `configJson.columns` on `SavedView`.

### Journey 4.8.2 — Sort

1. He clicks **Sort** → a popover with **"Sort by [field] [A→Z / Z→A]"**.
2. He picks a field and a direction. He clicks **+ Add another sort** to sort by a second field within the first (multi-level sort), and **drags** sort rows to change their priority.
3. The grid re-orders live. Removing all sorts returns to the default order. (Note: an active sort **disables manual drag-reorder** of rows — doc 4b.3's rule — with a "clear sort to reorder by hand" hint.)

- **Benchmark (beat this):** Airtable — sorting records — https://support.airtable.com/docs/sorting-records-in-airtable
- **Build docs:** internal — `configJson.sorts`; server-side ordering (Decision 5).

### Journey 4.8.3 — Filter (with AND / OR groups)

1. He clicks **Filter** → a **condition builder** popover.
2. He adds a **condition**: **[field] [operator] [value]**. The **operators offered depend on the field type** — e.g. text: *is / is not / contains / is empty*; number/currency: *= / > / < / between*; date: *is / before / after / is empty*; select: *is any of / is none of*; checkbox: *is checked*. ("is empty" keys off the null/absent rule — doc 4's *Empty values*.)
3. He clicks **+ Add condition** for more, and **+ Add group** to nest conditions; each group has an **AND / OR** toggle, so he can express "(A and B) or C".
4. The grid filters live; a **filter count badge** shows on the toolbar button so it's obvious a filter is active.

- **Benchmark (beat this):** Airtable — filtering with conditions (AND/OR groups) — https://support.airtable.com/docs/filtering-records-using-conditions
- **Build docs:** React Query Builder (AND/OR groups) — https://react-querybuilder.js.org/ ; compiled to a server-side WHERE over the JSONB values.

### Journey 4.8.4 — Group rows into sections

1. He clicks **Group** → **"Group by [field]"**. Rows collapse into **sections**, one per value of that field. **Any field groups**, including a **record-reference** — e.g. group Companies by **Parent company** to see each corporate family together (doc 4a.10), or group People by Company. Records with no value for the group field fall into a **"(No value)"** / **"(No parent)"** section, never hidden.
2. Each **section header** shows the group value, a **count**, and — for number/currency fields — an optional **sum or average** (e.g. "Won — 12 deals · $480k"; or, grouped by parent company, the family's total open-deal amount).
3. He can **collapse/expand** a section (and collapse-all / expand-all), and add a **second-level group** (group by Owner, then by Stage).
4. Grouping composes with sort and filter.

- **Benchmark (beat this):** Airtable — grouping records — https://support.airtable.com/docs/grouping-records-in-airtable
- **Build docs:** internal — `configJson.groupBy`; group aggregates computed server-side.

### Journey 4.8.5 — Edit a cell inline

He edits a cell **in place, without opening the record** — click, type, commit — the same gesture as the record page and the grid everywhere. The exact cursor/commit rules and optimistic-write behavior are pinned in **doc 4b.2** (so muscle memory matches Google Sheets).

- **Benchmark (beat this):** Google Sheets — inline editing (doc 4b.2 has the exact rules) — https://support.google.com/docs/answer/181110
- **Build docs:** doc 4b.2.

### Journey 4.8.6 — Control wrapping & truncation (the rep decides, we don't impose)

1. The default is **clip to one line** (dense, scannable), with the click-to-expand overlay (Journey 4.7 step 6) as the escape hatch, so nothing is ever unreadable.
2. **Per-column wrap toggle:** each column's header menu (the caret / right-click on the header) has **Wrap text ↔ Clip text**. Wrap shows the full value across multiple lines in that column.
3. **Row height** for the whole view: **Short / Medium / Tall** (the same control as display density, doc 4b.10). Taller rows + wrap = read everything; short + clip = scan fast.
4. **Where this lives, and "won't it look weird?"** — no. It sits in the **column header menu**, not an always-on toolbar, exactly like Google Sheets (*Format → Wrapping*) and Airtable's field/row-height controls. A clean on-demand dropdown is the expected place for it and adds no clutter to the grid. We deliberately do **not** build a Sheets-style top toolbar of formatting buttons — that would look heavy in a CRM.
5. Choices are **saved per view** (a "scan" view can clip; a "read" view can wrap).

- **Benchmark (beat this):** Airtable — row height / field wrap — https://support.airtable.com/docs/adjusting-row-height-in-airtable ; Google Sheets — text wrapping (Clip/Wrap/Overflow) — https://support.google.com/docs/answer/46973
- **Build docs:** wrap/clip + row height via Glide cell renderers + row-height config; saved on `SavedView.configJson`.

### Journey 4.8.7 — Show or hide grid lines (per view; off by default on list views)

*As a rep, I want a clean, lineless list by default but the option to turn grid lines back on, so that scanning feels calm but I can add structure when a dense table needs it.*

1. **Where it is.** The **Row height** control (4.8.6) in the view toolbar carries a **Grid lines** toggle beneath the Short/Medium/Tall choices (a single on/off switch). *(A cell's own click-to-expand and freeze-line behavior are unaffected — this toggle is purely the light row/column rule lines.)*
2. **The default depends on the layout, and this is deliberate:**
   - **List view** (the denser one-line-per-record layout, doc 4b) ships with **grid lines OFF** — a clean, Linear/Attio-style list where rows are separated by whitespace, not rules. This is your ask: list views should look calm out of the box.
   - **Grid view** (the spreadsheet-style table) ships with **grid lines ON**, because a spreadsheet *reads as* a spreadsheet only with its cell lines — turning them off there would fight the "feels like Google Sheets" bar (Journey 4.7).
3. **The toggle is always available on both**, so a rep who wants a lined list can switch it on, and one who wants a clean spreadsheet can switch it off. Turning lines off keeps the **frozen-row/column boundary line** (4.7 step 4) visible — that line is structural, not decorative, so it stays.
4. The choice is **saved per view** (`SavedView.configJson.gridLines`), so a "scan" list can stay lineless while a "reconcile" table keeps its lines.

- **Benchmark (beat this):** Linear — clean lineless lists (the default we match for list views) ; Google Sheets — gridlines on/off (*View → Show → Gridlines*) — https://support.google.com/docs/answer/58515 ; Airtable — grid view
- **Build docs:** Glide draws its own cell/row borders — set them transparent when `gridLines` is off (keep the freeze-boundary line); saved on `SavedView.configJson`.

### Journey 4.8.8 — Change Highlight mode ("what changed in the last N days")

*As a rep or manager, I want to turn on a mode that highlights every field that changed recently — with the before/current values and how often it changed — so that I can see at a glance what moved on my accounts without opening each record.*

This is the **table-wide face of field history** (per-field history popover is doc 4 Journey 4.5; this is the "highlight across the whole table" overlay). It reads the same `FieldHistory` data, rendered as a view overlay rather than a per-cell popover.

1. **Turn it on.** In the view toolbar, **Change Highlight** (a toggle) → he picks a **window**: **Last 1 / 7 / 30 days** (or a custom day count). The grid stays exactly as it is — this is an overlay, not a filter.
2. **Changed cells are highlighted.** Every cell whose value changed within the window gets a **subtle highlight** (a tinted background / left accent), so changed data pops against unchanged data. Cells that didn't change look normal.
3. **A change-count indicator per cell.** To the left of a changed cell, **small dots show how many times it changed** in the window (one dot = changed once, three dots = changed three times) — so a value that's been thrashing is visibly different from one clean edit. *(This is Scratchpad's "number of dots = number of times changed.")*
4. **Hover to see what changed.** Hovering a highlighted cell shows a compact **`previous → current`** (and, if it changed several times, the most recent change plus a "see full history" link into the 4.5 popover). So the overlay gives the gist inline; the full audit is one click away.
5. **Optional: only-changed filter.** A companion **"Show only changed rows"** switch hides rows with no change in the window, turning the whole view into a "what moved this week" report. Off by default (Change Highlight is an overlay first).
6. **Saved per view + shareable.** The mode + window are stored on `SavedView.configJson.changeHighlight` and encoded in the URL (doc 12a), so "here's what changed on our accounts this week" is a shareable link, and a manager can keep a saved "Weekly changes" view.

**Defensive points.** The overlay is read-only — it never edits data. It respects field-level permissions (a user only sees changes to fields he can read, doc 11). Windowed query on `FieldHistory` (indexed on `changedAt`) so turning it on stays fast even on big tables; if a field has no history yet, it simply isn't highlighted.

- **Benchmark (beat this):** **Scratchpad — "change highlight"** (turn on, pick days, see changed fields with previous/current + a dot-count, hover for detail) — https://www.youtube.com/watch?v=s7iFQYwE8DY ; **Airtable — record revision history** for the underlying `old → new` model — https://support.airtable.com/docs/record-level-revision-history-overview .
- **Build docs:** reads doc 4 Journey 4.5 `FieldHistory` (window on `changedAt`, count per `(recordId, fieldId)`); renders via Glide cell background + a small dot badge; `SavedView.configJson.changeHighlight = { on, days, onlyChanged }`.

## Journey 4.9 — Save a view and switch to kanban

*As a rep, I want to save a table setup and flip it to a kanban board, so that I can reuse my setups and drag deals through their stages.*

1. He saves the current setup (columns, sort, filter, group) as a named **view**. **What "per-object and shared to the workspace" means, precisely:**
   - **Per-object.** A view belongs to exactly one object (a People view, a Deals view). It shows up in that object's **view switcher** (a dropdown at the top of the table) and nowhere else.
   - **Personal vs Shared — the rep controls this; it is not forced.** A new view starts **Personal** (only he sees it). He can flip it to **Shared**, which makes it appear in the view switcher **for every member of the workspace** (single-user today, so this matters once teammates exist). So *yes, he can turn sharing off* — Personal is the off state, and it is the default. This is Airtable/Attio's personal-vs-collaborative-view model.
   - **Not link-gated.** "Shared" does **not** mean "anyone with a link." It means "visible to workspace members in the switcher." A non-member with the URL gets nothing (auth still applies).
   - **Discovery, not notification.** Sharing a view does **not** email anyone. A shared view simply **appears in the switcher** for everyone on that object — that is where people find it. **[LATER]** a subtle "new view" dot when teammates exist; no email spam.
   - **The URL also encodes the live view state.** Independently of saved views, the current columns/sort/filter/group are reflected in the **URL query params**, so a rep can paste a link and a teammate lands on the *same ad-hoc arrangement* even if it was never saved. Saving turns that transient state into a named, stored view. So both are true: a view is a stored object **and** any arrangement is reconstructable from the URL.
2. A button group at the top flips the view between **Table** and **Kanban**.
3. **Kanban, specified:**
   - He picks the **group-by field** — any **select/status** field (for Deals it defaults to **pipeline stage**). Each option becomes a column, in the field's configured order, using the option's color.
   - Each card shows a **title plus any number of fields he chooses** — **there is no hard cap.** We *default* to a small set (title + ~3) because dense cards get unscannable, but he can add more; past ~5 the picker shows a gentle "cards get noisy" hint rather than blocking him. So the "~3" is a recommended default, not a limit.
   - He **drags a card between columns to set that field** (drag a deal from "Demo" to "Won" sets stage = Won; job E1 logs it). Reordering within a column is manual sort.
   - A column header shows its **count** and an optional **sum** (e.g. total deal amount).
   - If the group-by field is empty on a record, it lands in a **"No value"** column.
4. Per view, he can reorder, hide, resize, and freeze columns (table) and choose card fields (kanban).

- **Benchmark (beat this):** Airtable — kanban — https://support.airtable.com/docs/getting-started-with-airtable-kanban-views
- **Build docs:** dnd-kit — sortable preset — https://dndkit.com/presets/sortable

## Journey 4.9a — Manage a view (rename, edit, duplicate, delete, share, set default)

*As a rep, I want to rename, tweak, copy, and remove my saved views so that my view switcher stays useful and I'm not stuck with a bad setup.*

Views are editable, renameable, and deletable — all of it. From the **view switcher** dropdown, each saved view has a **⋯ menu**:

1. **Rename.** Inline-rename the view; the new name shows in the switcher immediately.
2. **Edit (update the saved config).** He changes columns/sort/filter/group while the view is open; a **"Save changes"** affordance appears (and "Reset" to discard). This overwrites the stored config. Editing a **Shared** view changes it for everyone; the app says so before saving.
3. **Duplicate.** Copies the view (config + name + " copy"). The copy starts **Personal**, so experimenting never disturbs a shared view.
4. **Change sharing.** Toggle **Personal ↔ Shared** (Journey 4.9 step 1). Turning a shared view Personal removes it from teammates' switchers.
5. **Set as default.** Marks which view opens when the object is first clicked. There is always exactly one default per object (a system default ships and can be replaced).
6. **Reorder.** Drag views in the switcher to set their order.
7. **Delete.** Removes the view (config only — **records are never touched**), with an **undo toast**. A view is just a saved arrangement, so deleting one is low-stakes. The default view cannot be deleted until another is set default.

- **Benchmark (beat this):** Airtable — create & manage views — https://support.airtable.com/docs/creating-and-configuring-views-in-airtable ; Attio — views
- **Build docs:** internal — CRUD on `SavedView` (`ownerId` + `isShared` + `isDefault` + `sortOrder`; data model below).

## Journey 4.10 — Create and use a list

*As a rep, I want hand-picked lists of records with their own fields and order, so that I can build a call list or a target-account set without changing the underlying records.*

A **list** is a saved, hand-picked (or filter-fed) subset of one object's records, with optional fields that live only on the list. Example: a "Q3 Target Accounts" list of Companies, with a list-only "Priority" field the rep sets per row without touching the company record.

1. **Create.** From an object's table he clicks **New list**, names it, and picks the object it holds. Or he selects rows (checkbox) → **Add to list**. The list appears under a **Lists** section in the navbar.
2. **View / edit / remove.** Opening a list shows the same fast table (Journey 4.7), scoped to its members. He removes a record from the list (this does **not** delete the record) or adds more.
3. **List-only fields.** He clicks **Add list field** to add a field that exists **only on this list** (e.g. "Priority", "Called?"). He CRUDs both the field definition and each row's value. These values never appear on the underlying record — they are attributes of *membership*, not of the record.
4. **Manual order.** A list keeps its own **order**: he **drags rows** to reorder, or sorts by any column. Order is a property of *membership* (stored per entry), so the same records can sit in a different order in another list. This ordered list of People **is the "call list"** the dialer calls down — **defined here in 4.10 as the single source; doc 3 only adds "call down this list" and stores no separate call-list object** (doc 3 already removed its `CallList`/`CallListEntry` models and points here). Any object can have lists (People, Companies, Deals, Calls, custom), Attio-style.
5. **How row selection works — checkboxes + a real select-all.** This is the general table selection model (used here for "Add to list", and for any bulk action):
   - **Per-row checkbox on the left.** Each row shows a **checkbox in a leading column** (visible on row hover, and always visible once anything is selected). Clicking it selects that row; **Shift-click** selects a range.
   - **Header checkbox = select/clear all.** A checkbox in the **header** selects or clears everything. But "everything" is ambiguous with large data, so we use the Gmail/Airtable pattern: the header checkbox first selects **all rows currently loaded/visible in the view**, and a **banner appears** — *"All 100 on screen are selected. **Select all 12,340 in this view?**"* — with a one-click link to extend the selection to the **entire filtered set**. Clicking away or a "Clear" link deselects.
   - So the rep can bulk-act on **just what he sees** or on **the whole filtered result**, and it is always explicit which — never a silent "did that apply to 100 or 12,000?"
   - A **selection count + a bulk-action bar** ("Add to list · Change owner · Delete · Export") appears while any rows are selected.

- **Benchmark (beat this):** Attio — understanding lists — https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists ; Gmail / Airtable — "select all on screen vs. select all N" banner
- **Build docs:** Attio API — list entries — https://docs.attio.com/rest-api/endpoint-reference/entries/list-entries ; selection state = a set of row ids + an "all-in-filter" flag (so we never materialize 12k ids client-side).

---

## Background jobs (this doc)

This doc introduces **no new background jobs** — tables, views, and lists are read/config surfaces over the doc-4 data. They rely on the doc-4 E-series (E1 field-history logging on inline/kanban edits; E4 relation sync; E5 activity fan-out) and the server-side query layer described in Decision 5.

---

## Decisions (tables, views & lists)

**1. Table feel — how spreadsheet-like? — you said "very, very strongly spreadsheet-like." Decided: full Sheets-grade grid** (§A), built on a purpose-built grid library, not a hand-rolled table.

**2. Pagination — no visible pagination; it should feel like an endless Google Sheet. Decided (my pick, matching your instinct).** The best UX is "the rep never sees a pager — he just scrolls." Two independent mechanisms deliver it:
- **Render virtualization.** The grid (Glide Data Grid, §A) only ever draws the **visible rows** onto the canvas, so 50,000 rows cost about the same to render as 50 — it stays 60fps because only on-screen rows are drawn.
- **Windowed / chunked data fetch (not "send everything").** We do **not** ship all rows to the client. The client holds a **windowed cache** and fetches rows in **cursor-based chunks (~100–200) as the scroll approaches the edge** (infinite scroll under the hood). To the rep it looks like one continuous sheet; technically only a few hundred rows are resident. Sort/filter run **server-side** so the window is always over the right ordered set.
- **Why not classic pages, and why not "load all":** page numbers break the scroll-and-scan feel; loading all rows breaks performance on large objects. Windowed fetch gives the feel of the former with the safety of neither — how Airtable/Sheets behave at scale. (Server-side sort/filter/count also power the select-all-N banner in Journey 4.10.)

---

## Data model (Prisma) — additions in this doc

Extends doc 4. **New models marked `// NEW`.** (`PipelineStage`, referenced by the Deals kanban, lives in doc 4 with the other standard-object schema.)

```prisma
model SavedView {          // NEW — Journeys 4.8/4.9/4.9a (columns, sort, filter, table|kanban)
  id          String @id @default(cuid())
  workspaceId String
  objectId    String
  name        String
  layout      String        // table | kanban
  configJson  Json          // columns, sorts, filter tree, groupBy, kanban field + card fields; wrap/clip + rowHeight (4.8.6); gridLines on/off (4.8.7, default off for list layout); frozen rows/cols (4.7)
  ownerId     String        // creator; a Personal view is visible only to its owner (Journey 4.9)
  isShared    Boolean @default(false) // false = Personal (default); true = visible to the whole workspace in the switcher
  isDefault   Boolean @default(false) // the view that opens first for this object (exactly one per object)
  sortOrder   Int     @default(0)     // order in the view switcher (Journey 4.9a)
}

model ListEntity {         // NEW — Journey 4.10 (a subset with list-only fields)
  id          String @id @default(cuid())
  workspaceId String
  objectId    String
  name        String
  listFields  Json          // list-only attribute defs
}

model ListEntry {          // NEW — a record's membership + list-only values
  id        String @id @default(cuid())
  listId    String
  recordId  String
  valuesJson Json?          // values for the list-only fields
  position  Int?            // manual drag-drop order (Journey 4.10; the dialer's call order)
  @@unique([listId, recordId])
}
```

---

## Technical decisions, trade-offs & edge cases

**Filters compile to server-side SQL.** The AND/OR tree from react-querybuilder (Journey 4.8.3) is compiled to a parameterized WHERE over the JSONB values, so filtering happens in Postgres (GIN-indexed), not in the client — which is what keeps the windowed fetch (Decision 2) correct: the window is always a slice of the *filtered, sorted* set, never the raw table.

**Sort vs. manual order conflict.** A saved sort (4.8.2) and a hand-drag order (4.10 / 4b.3) contradict each other. Rule (Todoist's, adopted in doc 4b.3): when a sort is active, manual drag is disabled with a "clear sort to reorder by hand" hint; row reorder maps the visible drop position back to the real `position`, never the view index.

**Group aggregates.** Section counts/sums (4.8.4) are computed server-side per group key so a grouped view over 50k rows doesn't pull all rows to sum a column.

---

## §A — Spreadsheet-grade table (referenced from Journey 4.7)

The table must feel like Google Sheets even at tens of thousands of rows. This section is the requirements, the feature audit, and the library choice.

**Requirements (first principles, before the library):**
1. Stay fluid (60fps scroll/edit) at 10k–100k rows without server paging for common views.
2. Spreadsheet-grade interaction **out of the box**: range select, keyboard nav, type-to-edit, multi-cell paste, undo — not hand-built.
3. Copy/paste TSV interop with Excel/Google Sheets, both directions.
4. CRM cell types: text, number, date, currency, enum chips, checkboxes, links.
5. Frozen header + frozen leading column(s); column resize/reorder.
6. **Free + open-source, permissive license** (MIT/Apache) — no GPL, no commercial key gating the features we need.
7. Themeable to our design (light/dark, selection tint, active-cell outline).

**Feature audit — what "feels like Sheets" means** (must/nice/skip for v1):

| Behavior | In Sheets | In Airtable | Our call |
|---|---|---|---|
| Active-cell outline; single select | ✓ | ✓ | must |
| Range select (drag, shift-click) | ✓ | ✓ | must |
| Column/row select; select-all (⌘A) | ✓ | ✓ (row) | must |
| Arrow nav; Tab/Enter advance; Shift+Arrow extend | ✓ | ✓ | must |
| Type-to-edit; F2/dbl-click; Esc/Enter | ✓ | ✓ | must |
| Paste multi-cell block; copy to/from Excel (TSV) | ✓ | ✓ | must |
| Multi-step undo/redo | ✓ | ✓ | must |
| Frozen header + frozen columns | ✓ | ✓ | must |
| Column resize + reorder | ✓ | ✓ | must |
| In-cell select chips + checkboxes | via dropdown | ✓ | must |
| Selection tint + header highlight | ✓ | ✓ | must |
| Ctrl+Arrow jump; Home/End; PageUp/Down | ✓ | partial | nice |
| Fill-down / drag handle | ✓ | ✓ | nice |
| Multi-range select (⌘-click) | ✓ | ✗ | nice |
| Conditional formatting; cell background color | ✓ | via rules | nice |
| Font styling (bold/color per cell) | ✓ | limited | skip (v1) |

**Library options:**

| Library | Rendering | 10k–100k rows | Built-in kbd/selection | License |
|---|---|---|---|---|
| **Glide Data Grid** | Canvas | Excellent (millions) | Full: range, fill, copy/paste, kbd nav | **MIT** ✅ |
| AG Grid | DOM | Excellent | range/fill/clipboard are **Enterprise-only** | Community MIT / core features **paid** ⚠️ |
| Handsontable | DOM | Very good | Full, Excel-like | **Commercial/paid** ❌ |
| RevoGrid | DOM (web comp.) | Very good | Range/edit/clipboard built-in | **MIT** ✅ |
| react-datasheet-grid | DOM | Good (~100k ok) | Sheets-like nav/select/paste/fill | **MIT** ✅ |
| TanStack Table | Headless (you render) | state ok; DOM render is the bottleneck | **none — you build it** | MIT ✅ |

**Why TanStack felt slow (your experience):** it's a headless *state* engine with zero rendering, selection, or editing — you supply the DOM, so at 10k+ editable rows every keystroke re-runs the row model and re-renders React DOM; with rich cells + virtualization glue, it janks. That's architectural, not a bug. Purpose-built grids co-design selection/edit/paste/virtualization; **canvas** grids skip the DOM entirely — a structural win for large editable grids.

**Pick: Glide Data Grid** (MIT, canvas). It's built for exactly this — scrolls millions of rows and ships range select, keyboard nav, fill, and Excel-compatible copy/paste natively, which answers both "feel like Sheets" and the editable-grid perf concern, and avoids AG Grid/Handsontable's paid gating. **Trade-off:** canvas means no CSS/DOM styling — cells and custom widgets (chips, checkboxes) are drawn via renderer callbacks, so bespoke visuals and accessibility take more code. **Fallback** if DOM/CSS theming matters more than raw row count: **react-datasheet-grid** (MIT, DOM, good to ~100k).

- Sources: [Glide Data Grid (MIT)](https://github.com/glideapps/glide-data-grid) · [AG Grid community vs enterprise](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/) · [Handsontable license](https://handsontable.com/docs/react-data-grid/software-license/) · [react-datasheet-grid](https://github.com/nick-keller/react-datasheet-grid) · [TanStack virtualization](https://tanstack.com/table/v8/docs/guide/virtualization)
