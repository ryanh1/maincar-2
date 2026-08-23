# Doc 4b — Grid View: Power Editing & Keyboard

Part of the **CRM Data & Views** family (head: **[4 — Objects, Fields & Schema](4-crm-data-and-views.md)**; base grid/views/lists in [4c](4c-crm-tables-views-lists.md), records/notes/tasks in [4d](4d-crm-records-notes-tasks.md), search/notifications in [4e](4e-crm-search-notifications-attention.md), **composite cells in [4f](4f-crm-composite-cells.md)**, **AI columns in [4g](4g-crm-ai-columns.md)**). This doc is the **power layer on top** of the base grid: a **grid view** that shows several object types at once, Google-Sheets-grade editing, color rules, rich dropdowns, column groups, keyboard-first input, and a record page you edit without ever clicking "Save". These are the features that decide whether the app *feels* like Superhuman/Linear or like Salesforce.

**Naming (your ask): we call the two layouts "grid view" and "list view."** A **grid view** is the spreadsheet-style, multi-column, editable table this doc covers (single-object or the multi-object cockpit of Journey 4b.1). A **list view** is the denser, one-line-per-record layout used for tasks (doc 4b.9) and inbox-style screens. Both are `SavedView.layout` values.

**Benchmarks:** **Google Sheets** (editing feel), **Attio/Airtable/Clay** (grid + linked records), **Sigma** (the multi-object grid), **Linear/Superhuman** (keyboard + speed), **Todoist** (task lists), **Gmail** (density).

**Journey numbering:** sub-doc 4b, so journeys are `4b.1`, `4b.2`, …

**Depends on:** doc 4c §A (the Glide Data Grid choice), doc 4c Journeys 4.7/4.8, doc 4d Journeys 4.11/4.14. Composite cells → doc 4f. AI columns → doc 4g.

**A rule for every form/panel/popover in this doc:** it is **fully keyboard-navigable** — `Tab`/`Shift+Tab` move between controls, `Enter` confirms, `Esc` cancels — so the rep can configure anything without the mouse (your ask). Individual journeys don't repeat this; it's assumed everywhere.

**Covers:** multi-record-type grid views, Google-Sheets cursor/editing parity, column/row reorder + copy-paste + fill, conditional color rules, dropdown colors + display labels, column groups (hide/group/collapse), @/-commands for dates and records, active-call row highlight, tasks/reminders list view, zoom/density, record-detail customization + inline edit, optimistic updates, formatted fields, multi-value sort, and a discoverable+customizable keyboard system. *(Composite cells → doc 4f; AI columns → doc 4g.)*

---

## Journey 4b.1 — The multi-object grid view (one table, several record types)

*As a rep, I want one table that stitches a company together with its people, its activity, and its deals, so that I can work an entire account from a single row instead of jumping between separate object tables.*

This is the big one. Today a table shows one object (People *or* Companies). The rep wants **one table that composes several** — one row per **Company**, but each row also carries a Person, an **Activity** column stacking that account's Calls + Emails, and a **Deals** column — like this:

```
Company        Website        Size  │ Person          Email            │ Activity (Calls+Emails)        │ Deals
──────────────────────────────────── │ ─────────────────────────────── │ ────────────────────────────── │ ─────────────────────
Acme  ⌂ shared  acme.com  ⌂    120   │ Dana Reeve      dana@acme.com    │ Aug 14 · Call · Connected · …  │ Acme Renewal — Sam
Acme  ⌂ shared  acme.com  ⌂    120   │ Omar Reyes      omar@acme.com    │ Aug 12 · Email · Reply · …     │ Acme Expansion — Lee
                                      │                                  │ Aug 09 · Call · Voicemail · …  │
```

1. He builds the view by picking a **root object** (Company) and adding **columns that reach into related objects** (a Person's fields, an Activity feed, the account's Deals).
2. **The rules that make it work** (all configurable per column):
   - **Repeated-parent cells** (Company name/website/size) show once and **repeat down** when a company has several people. They render as **shared/greyed "merged" cells** (Sigma's "repeat row labels") so it's visually obvious they're one record, and **editing one edits the underlying company** and updates every repeat (edit-through-to-source — see edge cases).
   - **Multi-value cells** (the Deals column) show **several child records as a vertical list**, each a hyperlink to its detail.
   - **Combination cells** (the Activity column) **merge two object types** — Calls + Emails — into one feed, with a **type-priority order** ("show Calls first, then Emails") and then a **sort-by** (date desc). Each item is projected to a common shape: icon · title · timestamp · link.
   - **Composite horizontal cells** show several fields on one line via a **template string** — `{deal.name} — {owner.name}` renders "Acme Renewal — Sam". This is the piece no off-the-shelf tool does; it's why we need templates.
   - **Per-cell limit + "show N more"** — a company with 200 activities shows the top N by the sort rule, capped cell height, with a drill-in for the rest.
3. **Templates.** He can save a composed view as a **template** ("Account cockpit", "Deal room") and reuse it. A few ship by default.
4. **Configurable everything:** which objects, which columns, per-column reduction/sort/type-priority/limit/template, and whether a multi-child column **fans out to one row per child** (true denormalization) or stays a **nested list in one row** (the default).

**How it's built — in plain English (you asked me to clarify these two phrases):**

- **"Denormalizes at read time — not stored as flattened rows."** *Denormalize* means "stitch related records together into one wide row." We do that **only when the view loads** — the app runs a query that pulls each Company together with its Person, its activity, and its Deals and lays them out as the wide rows you see. We **do not save those wide rows anywhere.** Open the view again and it re-stitches from scratch. (Contrast: a system that *stored* flat rows would have to keep them in sync forever — we avoid that.)
- **"Stored data stays normalized."** The underlying data lives in its **clean, separate tables with relations** — Company here, Person there, Call/Email/Deal elsewhere — with **no duplication**. Editing a value in the grid edits **that one source record** (edit-through, doc 4f.4); it can't drift, because there's only one copy.

**The Activity cell reuses doc 4a's feed — there is no separate union query, and no conflict (you asked).** An earlier draft said the Activity cell runs a live "union query across Call + Email." Now that doc 4a maintains the **`CompanyActivity` feed** (job E5 — one summary row per activity, keyed by company), **the grid's Activity cell simply reads that same feed**, filtered to the row's company. This is *better*: it reuses the work E5 already does, matches exactly what the record page shows, and — answering **"what if we want other activity types"** — the feed already carries a **`kind`** field (call | email | text | meeting | note | task | custom), so adding LinkedIn messages later is a new `kind`, **not** a new query or schema change. So: the **wide rows** are composed at read time; the **activity within a cell** comes from the pre-built 4a feed. No duplication of 4a's decision, no conflict.

The view definition (JSON) holds the root object, the column resolvers, and each column's reduction/sort/limit/template. This is Sigma's join-grid model + Clay's array cells + Attio's merged activity feed, combined. *Composite-cell specifics (chips, sub-editing, delete safety) are their own doc — [4f](4f-crm-composite-cells.md).*

**Re-analysis: do our tech choices actually meet these requirements? (your ask).** I re-checked each requirement against the chosen stack:

| Requirement (from 4b.1 / doc 4f) | Met by | Verdict |
|---|---|---|
| One row per parent, repeat parent down | read-time resolver + Glide row model | ✅ |
| Multi-value / composite cells (lists, chips, chip+text) | Glide **custom cell renderers** draw arbitrary content | ✅ (custom draw) |
| Merge two object types in one cell | the union-query resolver → common shape | ✅ |
| Edit-through-to-source, sub-cell editing, status dropdown inside a sub-cell | Glide **overlay editors** + custom hit-testing | ⚠️ **hardest part** |
| 60fps at 10k–100k rows | canvas rendering | ✅ |
| Read-time denormalization, no stored flat rows | JSON view-definition + cached query | ✅ |

**The honest risk, and the call.** Everything is met **except** the interactive part of composite cells — a canvas grid draws chips/lists easily, but making a **status chip inside a vertical sub-row open a dropdown** (doc 4f) needs custom **hit-testing** (which sub-cell did the click land on?) plus an **overlay editor** positioned over that sub-cell. Glide supports both, but this is real custom work and the main build risk. **The choice stands** (Glide's scale + Sheets feel are worth it), with **one fallback stated up front:** if interactive composites prove too heavy on canvas, we render the **composite-heavy "cockpit" views** on **react-datasheet-grid** (DOM — interactive sub-cells are trivial there, capped ~100k rows) while plain object tables stay on Glide.

**Pagination & large datasets — how scrolling works (your ask).** A grid view **never shows a pager**; it scrolls like an endless sheet, using the **windowed virtualization from doc 4c Decision 5**: only the **visible rows** are rendered (canvas) and rows are **fetched in cursor-based chunks (~100–200) as the scroll nears the edge**. For the **multi-object grid**, the same window applies to the **per-row resolvers** — we only resolve the related records (person, activity, deals) for the **rows currently on screen**, not all of them, so a 50k-company cockpit view stays fluid and cheap. Sort/filter/group run **server-side** so the window is always over the correct ordered set. (So: virtualized rendering + chunked fetch + windowed resolvers = no pagination UI, no all-rows load.)

- **Benchmark (beat this):** Sigma — denormalized pivot/join grid ("repeat row labels") — https://help.sigmacomputing.com/docs/working-with-pivot-tables ; Clay — array/lookup cells — https://university.clay.com/docs/lookup-rows ; Attio — synced activity on records — https://attio.com/help/reference/managing-your-data/records/add-record-activities ; Salesforce — grouped/matrix reports (the classic model) — https://help.salesforce.com/s/articleView?id=sf.reports_builder_fields_groupings.htm
- **Build docs:** Glide Data Grid — custom cell renderers (for list/composite/activity cells) — https://docs.grid.glideapps.com/api/dataeditor/custom-cells ; react-datasheet-grid (DOM fallback for interactive composites) — https://github.com/nick-keller/react-datasheet-grid ; internal — the view-definition + union-query resolver.

## Journey 4b.1a — Compose a multi-object view (the click-path)

*As a rep, I want a clear step-by-step way to add columns that reach into related objects, so that I can build an account cockpit myself without a data team.*

Journey 4b.1 describes **what** a multi-object view is; this is **how a user builds one**, click by click. It starts from any ordinary **list/table view** (doc 4c) — the multi-object grid is not a separate app, it's a normal view with related columns added.

1. **Start from the root object's list.** He opens the **Companies** list (doc 4c Journey 4.7). This table's root object is Company; every column he adds hangs off a Company row.
2. **Add a related column.** He clicks the **`+` at the far right of the header** → the add-column menu now has, alongside normal field types, **"From a related object →"**. Hovering it shows the **relationship paths one hop out** from Company: **People (at this company)**, **Deals**, **Activity (Calls + Emails + …)**, **Parent company** (doc 4a.10), and any custom relation.
3. **Pick the path, then what to show.** He picks **People →** and a small config appears:
   - **Which field(s)** of the related object to show (Name, Email, Title…), or a **template** (`{person.name} — {person.title}`, Journey 4b.1 rule 4).
   - **How to reduce many** (a company has many people): **fan out to one row per person** (true denormalization) or **stack as a list in one row** (default) — Journey 4b.1 step 4.
   - **Sort & limit** within the cell (e.g. "primary contact first", "top 3, show N more").
4. **Add an Activity column the same way.** He picks **Activity →**, chooses **which kinds** to merge (Calls, Emails, Notes…), the **type-priority** ("Calls first"), and the **sort** (newest first). This reads the pre-built `CompanyActivity` feed (doc 4a, job E5) — not a fresh union query — so it matches the record page exactly (Journey 4b.1 step, "the Activity cell reuses doc 4a's feed").
5. **See it compose live.** As he adds each column, the grid **re-stitches at read time** (Journey 4b.1) — repeated-parent cells grey-merge, multi-value cells stack, composite cells render their template. He reorders/resizes/freezes these columns like any other (Journey 4b.11 / doc 4c 4.8).
6. **Edit through to the source.** Editing a related cell writes to the **one underlying record** (edit-through, doc 4f.4) — editing "Dana's title" in the cockpit edits Dana's Person record, and every repeat updates.
7. **Save it as a view (and optionally a template).** He saves the arrangement as a named **view** (doc 4c Journey 4.9); its full definition (root object + column resolvers + reductions/sorts/limits/templates) is stored on the view and **encoded in the URL** (doc 12a), so a teammate opening the link sees the same cockpit. Saving it as a **template** ("Account cockpit", "Deal room") makes it reusable across workspaces (Journey 4b.1 step 3).

**Where this lives relative to the "list view" section.** A multi-object view **is** a saved view of the root object (doc 4c owns saved views, lists, kanban). So in the list/view switcher it appears next to plain views; the only difference is it has related columns. Nothing about the list-view machinery (filter, sort, group, share, default) changes — related columns just participate in it (e.g. you can **group the cockpit by Parent company**, Journey 4a.10 / doc 4c 4.8.4).

**Defensive points.** Only **one-hop** relationships are offered in the column picker by default (deeper paths get slow and confusing) — a second hop is possible but flagged "may be slower". If a related field is empty for a row, the cell shows empty, never an error. Windowed resolvers (Journey 4b.1) mean adding related columns to a 50k-row table stays fluid because only on-screen rows resolve.

- **Benchmark (beat this):** **Sigma — building a join/lookup grid** (add a column from a joined table) — https://help.sigmacomputing.com/docs/working-with-pivot-tables ; **Clay — add a "lookup / enrich from related table" column** (the pick-a-relationship-then-a-field flow) — https://university.clay.com/docs/lookup-rows ; **Attio — add related activity/columns to a view** — https://attio.com/help/reference/managing-your-data/records/add-record-activities .
- **Build docs:** the column picker writes a resolver spec (`{ path, fields|template, reduce, sort, limit, fanOut }`) into the view definition (the `GridView.columnsJson` shape, Journey 4b.1); Activity columns bind to the `CompanyActivity` feed (doc 4a E5).

## Journey 4b.2 — Edit in the table exactly like Google Sheets

*As a rep, I want the grid to behave exactly like Google Sheets — click, type-to-replace, Enter/Tab to move, undo — so that my spreadsheet muscle memory just works and I never think about the tool.*

Doc 4c §A committed to Glide Data Grid and listed the must-have behaviors. This journey pins the **exact cursor rules** so the build matches muscle memory. Research finding: Glide gives ~70% of this free; the rest is a focused edit-intent layer we write.

1. **Single click** selects a cell (crisp active outline, fill handle at the corner) — **no edit yet**.
2. **Type any character** on a selected cell → **overwrites** the value and enters edit mode with just that character (the single most important Sheets behavior — "type-to-replace"). **Double-click / F2 / Enter** edits **in place** with the cursor at the end.
3. **Commit + move:** **Enter** commits and moves **down**; **Shift+Enter** up; **Tab** commits and moves **right**; **Shift+Tab** left. **Esc** cancels and reverts.
4. **Selection:** arrows move; **Shift+Arrow** extends a range; **Cmd/Ctrl+Shift+Arrow** extends to the data edge; **Cmd/Ctrl+Arrow** jumps to the edge; click a header selects the column; **Cmd/Ctrl+A** selects all; **Delete/Backspace** clears.
5. **Undo/redo:** multi-step (`Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z`) — we maintain the edit-history stack ourselves (Glide has none).
6. **Optimistic writes:** every edit shows **instantly**, then reconciles with the server; on failure the cell **rolls back** with a small toast (see Technical decisions → Optimistic updates).

- **Benchmark (beat this):** Google Sheets — keyboard shortcuts (the exact rules) — https://support.google.com/docs/answer/181110
- **Build docs:** Glide Data Grid — input & interaction — https://docs.grid.glideapps.com/api/dataeditor/input-interaction ; TanStack Query — optimistic updates — https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates

> **Composite cells moved to their own doc → [4f — Composite Cells](4f-crm-composite-cells.md).** Cells that hold several values (a date chip + a disposition, a stacked list of people, or a combination), how you build them, the sub-cursor navigation, edit-through, the safe delete (unlink vs delete), and every keystroke are all specified there. Grid views (this doc) *use* composite cells; 4f *defines* them.

## Journey 4b.3 — Reorder, copy-paste, and fill

*As a rep, I want to reorder, copy, paste, and fill just like a spreadsheet, so that bulk edits are fast and never surprising.*

1. **Reorder columns:** drag a column header to a new position (Glide `onColumnMoved`); the view remembers it.
2. **Reorder rows:** a **drag handle** on the row moves it — **but only in a manually-ordered view or list** (doc 4.10's `position`). If a **sort** is applied, manual drag is **disabled** (a sort and a hand-order fight each other) — the app shows "Clear sort to reorder by hand." (Todoist enforces exactly this rule.)
3. **Copy/paste a block:** `Cmd/Ctrl+C` copies a range as TSV (pastes into Excel/Sheets); `Cmd/Ctrl+V` pastes a TSV block anchored at the active cell, **growing the selection to the clipboard's shape** (adding rows if needed). A single copied value **tiles** across a larger paste selection.
4. **Fill handle:** drag the corner handle to copy a value or extend a series across a range; `Cmd/Ctrl+D` fills down, `Cmd/Ctrl+R` fills right. (Glide draws the handle; we compute the filled values.)
5. **Guards:** pasting/filling **into a read-only or AI-computed column is blocked** (or skipped, shifting the remaining values) so we never silently overwrite generated data or mark an AI cell as human-authored.
6. **Reorder a row that has a repeated-parent cell** → drag is disabled in a fanned-out view (rows aren't independent there); allowed only in a manual list (per Decision 3).

*Copy/paste/fill **inside composite cells** (the sub-value rules, the "paste TSV into a composite" behavior, fill-can't-fabricate-records) is specified in **[doc 4f — Journey 4f.7](4f-crm-composite-cells.md)** with the full keystroke table.*

- **Benchmark (beat this):** Google Sheets — copy/paste + fill ; Airtable — grid editing — https://support.airtable.com/docs/getting-started-with-a-grid-view
- **Build docs:** Glide Data Grid — copy & paste support — https://docs.grid.glideapps.com/extended-quickstart-guide/copy-and-paste-support ; Glide — fill-handle story — https://glideapps.github.io/glide-data-grid/?path=/story/glide-data-grid-dataeditor-demos--fill-handle

## Journey 4b.4 — Color a field by a rule (e.g. next step by due date)

*As a rep, I want cells to color themselves by a rule I control — overdue dates red, at-risk deals amber — so that the table flags what needs attention without me reading every row.*

1. **Where it lives (your "where is it?" ask).** The **view toolbar** (doc 4c 4.8) has a **Format** button (a paint-swatch icon) next to Fields/Filter/Sort/Group. Clicking it opens the **Conditional formatting** panel for the current view. *(Shortcut: a single column's rules are also reachable from that column's header menu → "Conditional formatting…", pre-scoped to the column.)*
2. He adds a rule: *when `nextStep` date is **before today** → background red; **is today** → amber; **after today** → green.* Rules **stack, first match wins**, and he can drag to reorder them.
3. Each rule targets **cell background, text color, or a dot** — his choice — and can key off any field (date passed, status = "At risk", amount > X).
4. **Composite cells — how a rule applies when a cell has several values (your ask).** A rule can be scoped two ways, and the panel makes him pick:
   - **Whole cell** — color the entire cell (e.g. tint the whole Activity cell if its newest item is a voicemail). For a multi-value cell this uses the same **reduction** as sorting (4b.14) — "the newest item's date is overdue."
   - **Per sub-value** — color **just the matching chip/sub-row** (e.g. in a combination Activity cell, turn only the **overdue** date chips red, leaving the others normal). This is the more useful one for cockpits and is the default when the target field lives inside a composite.
5. **Some rules ship on by default, and he can change or restore them (your ask).** A small, seeded set is **on out of the box** — most importantly the **due-date temperature** (overdue = red, today = amber, upcoming = green) on task/next-step date fields, so a new workspace is useful immediately. He can:
   - **toggle any default rule off** (a per-rule enable switch),
   - **edit** its colors/thresholds like any rule, and
   - **Reset to defaults** to restore the seeded set.
   Defaults follow the doc-4 seeding rule (*seed idempotently, never overwrite the user's edits, back-fill new defaults later*) — so editing a default never gets clobbered, and we can add new default rules in a release without wiping his.
6. Rendered via Glide's **`themeOverride`** per cell / per sub-value (the same mechanism that tints AI-written cells) — cheap at row/column level, per-cell where needed.

- **Benchmark (beat this):** Airtable — conditional coloring — https://support.airtable.com/docs/using-conditional-colors-in-a-grid-view ; Attio — conditional highlighting ; Google Sheets — conditional formatting (the rule-builder feel) — https://support.google.com/docs/answer/78413
- **Build docs:** Glide Data Grid — styling / `themeOverride` — https://docs.grid.glideapps.com/api/dataeditor/styling ; `ColorRule` model (below), with a `scope` (cell|subvalue) + `isDefault`/`enabled` flags.

## Journey 4b.5 — Rich dropdown fields: colors + display labels

*As an admin, I want dropdown options to have good default colors and readable labels that I can change, so that statuses and stages look right everywhere and export as clean values.*

Dropdown (select/status) fields drive **Person status, Company status, Company type, Deal stage**, and more — so they need to look and read right.

### Journey 4b.5.1 — Colors: auto-assigned, then edited (the exact user journey)

You asked what "auto-assigned / editable" actually means as steps. Here it is:
1. The admin adds a select field and types option names ("New", "Working", "Won"). As he adds each one, the app **immediately assigns it the next color from a curated, on-brand palette** — so the field looks good with **zero** color work. (This is the "auto-assigned" part.)
2. To change a color, he **clicks the color swatch on an option** → a **color picker popover** opens showing (a) the **curated palette swatches** (the safe, on-brand choices) and (b) an **"+ Custom color"** control (hex input / eyedropper).
3. He clicks a swatch → the option (and every chip using it, everywhere — table, kanban, record page, timeline) **recolors instantly**. A custom color is **saved to the workspace palette** for reuse on other options/fields.
4. There is nothing to "save" — the change is live. (This is the "editable" part.)

### Journey 4b.5.2 — Display label ≠ stored value

Each option carries an optional **display label** distinct from its underlying **value** — so the value stored/exported/queried is `closed_won` while the rep **sees** "Closed — Won 🎉", or an imported code `S3` shows as "Stage 3: Demo". The label is what's shown; the value is what filters, reports, and the API use.

### Journey 4b.5.3 — Create, rename, relabel, recolor, reorder, and retire options (the exact user journey)

You asked for the user journey behind "he CRUDs options." From the field's **Edit options** panel:
1. **Add.** He clicks **+ Add option**, types a name → it appears with an auto-color (4b.5.1) and an editable value/label.
2. **Rename the label / edit the value.** He edits the **label** freely (cosmetic, safe). Editing the **stored value** is guarded: because filters, reports, and the API key off the value, the app **warns** ("312 records use this value; changing it updates them all") and, on confirm, **migrates every record** from the old value to the new in one write. He usually won't touch the value.
3. **Recolor / relabel** — per 4b.5.1 / 4b.5.2, live.
4. **Reorder.** He **drags options** to reorder; the new order drives the **dropdown order and the kanban column order** at once.
5. **Retire an option (the careful one).** He can't just vanish an option that records use. **Archive option** hides it from the picker for *new* entries but **keeps existing records** showing it (so history is intact); a **"reassign & remove"** flow lets him move those records to another option first, then delete it. A confirm states how many records are affected.
6. **Restore** an archived option to bring it back to the picker.

- **Benchmark (beat this):** Airtable — single-select field (colored options, editing) — https://support.airtable.com/docs/single-select-field ; Attio — status attributes
- **Build docs:** internal — extends `AttributeDef.optionsJson` (doc 4) with `{value, label, color, order, archived}` per option; a value-rename runs a bulk record migration.

> **AI columns moved to their own doc → [4g — AI Columns](4g-crm-ai-columns.md).** The column whose cells run an AI instruction you write (with `{{variable}}` fields, a ▶ play button, run-all, typed outputs, provenance, the model/tools/system-prompt behind it, evals, and 20 example instructions) is fully specified there. Grid views (this doc) *host* AI columns; 4g *defines* them.

## Journey 4b.7 — @-commands and /-commands everywhere (keyboard-first relations)

*As a rep, I want to link records, mention teammates, pick dates, and set statuses with a couple of keystrokes, so that I never reach for the mouse to do the things I do all day.*

Typing **`@`** opens a picker; **what it offers depends on what you're typing into**, and the sub-journeys below cover each case. Typing **`/`** runs a command. The same grammar works in the grid, the record page, notes, tasks, and the composer.

### Journey 4b.7.1 — `@` to link a record, or to mention a teammate (your "how do we mention named users?" ask)

1. In any text field, note, task, or composer, typing **`@`** opens the **grouped picker from doc 4.15** — sections **Teammates**, **Contacts**, **Companies**, **Deals** — filtered as he types.
2. **Mention a named user (teammate):** he picks from the **Teammates** section → a mention chip is inserted **and that user gets a notification** (doc 4.16). This is the "mention a person" case.
3. **Link a record (contact/company/deal):** he picks from a record section → a **linked chip** is inserted that **just links** (navigates on click); **no notification** — nobody is pinged for linking a company.
4. The chip is **resolved server-side to a stable id** (doc 4.15), so a rename never breaks it.

### Journey 4b.7.2 — `@date` opens a date **picker**, Sheets-style (your ask)

1. Typing **`@`** in a **date context** (a due-date field, a callback field, or `@` followed by a date word) opens a **date-picker popover — a small calendar**, exactly like clicking a date cell in Google Sheets.
2. He can **click a day**, or **keep typing words** — "tomorrow", "next tue", "friday 1pm" — which **moves the calendar to the parsed date** (parsed by **chrono-node**) so he can confirm with `Enter`. So it's a picker *and* a type-ahead, not text-only.
3. Picking sets the real date/time value on the field.

### Journey 4b.7.3 — `@` on a status field opens the **status options dropdown**, Sheets-style (your ask)

1. On a **status/select cell** (or typing `@` targeting a status field like `@stage`), the picker that opens is **that field's own options dropdown** — the colored chips (Won / Lost / Demo…) — exactly like a Google Sheets data-validation dropdown.
2. He arrows to an option and hits `Enter` → the status is set in one gesture, no free-typing. (This is why status fields don't fall through to the generic record picker: for a constrained field, offering its real options is faster and prevents invalid values.)

### Journey 4b.7.4 — `/` runs a command in place (your "I don't understand — give examples + why" ask)

The `/` menu **does an action right where the cursor is**, so the rep never leaves the field to go find a button. Concrete examples of the user journey:
- In a **note** on Dana's record, he types **`/task`** → a task composer opens inline, pre-linked to Dana; he sets "call back Tue" and hits `Enter` → a task is created without opening the Tasks page.
- In the **grid**, on Dana's row, **`/call`** → starts a call to Dana.
- In a **cell or note**, **`/status won`** → sets Dana's deal stage to Won in place.
- **`/note`** → drops a new note inline.
**Why it's necessary:** without it, "make a task about this person" means leaving the record, opening the Tasks page, creating a task, and re-linking the person — four steps. `/task` is one. It's the same reason Notion/Linear use slash commands: keep the action next to the context. (`/` inside a text field inserts/acts; `/` at rest is an alias for the command palette, doc 4.12.)

### What powers `@`, and where it's enabled (your tech ask)

- **The component:** in **rich text surfaces** (notes, composers, the record page) `@`/`/` are the **TipTap suggestion/Mention extensions** (doc 4.15). In the **canvas grid** (Glide has no DOM), the same menus are a **custom overlay-autocomplete** we position over the active cell (part of the overlay-editor layer from 4b.2a) — same data source and resolver, different host.
- **Where it's enabled — by field type, not everywhere:** `@`-to-link and `/`-commands are enabled in **text, note, task, and composer** fields; `@date` is offered in **date/timestamp** fields; the status dropdown is offered in **select/status** cells. It is **not** offered in pure **number / checkbox / currency** cells (nothing to mention or pick there).

**Each thing you can `@`, and what happens (your "think through each" ask):**

| You `@`… | Menu section | What happens |
|---|---|---|
| a teammate (User) | Teammates | mention chip **+ notification** to that user |
| a contact (Person) | Contacts | linked chip, navigable, **no** notification |
| a company / deal / record | Companies / Deals | linked chip, navigable, no notification |
| a date | (date picker) | opens the calendar; sets a real date value |
| a status field | (that field's options) | opens the status dropdown; sets the value |

- **Benchmark (beat this):** Notion — slash commands + `@` dates/people — https://www.notion.com/help/guides/using-slash-commands ; Google Sheets — in-cell dropdowns + date picker — https://support.google.com/docs/answer/13951556 ; Linear — inline command menus
- **Build docs:** TipTap suggestion/mention (rich surfaces) — https://tiptap.dev/docs/editor/extensions/nodes/mention ; chrono-node (NL date parsing) — https://www.npmjs.com/package/chrono-node ; internal — the grid overlay-autocomplete + the mention resolver from doc 4.15.

## Journey 4b.8 — The record I'm calling lights up in the list

*As a rep, I want the record the dialer is currently calling to light up and stay in view in any open table, so that I never lose my place while working down a list.*

When the dialer is working a list and a table of those records is open, the rep should never lose his place.

1. As the dialer moves to a record, **its row auto-highlights** in any open table/list of that object, and the grid **auto-scrolls** it into view.
2. The highlight is a distinct **"active call" treatment** (left accent bar + tint), separate from selection, so it reads even if he's selected other rows.
3. Clicking elsewhere never steals the highlight — it follows the **live call**, not the cursor. When the call ends, the highlight fades to a subtle "just called" marker for a few seconds.

- **Benchmark (beat this):** PhoneBurner / Orum power-dialer "current record" focus ; Linear — active-row focus feel
- **Build docs:** internal — subscribe the grid to the live-call record id (doc 2/3 dialer state); Glide `getRowThemeOverride` for the row treatment.

## Journey 4b.9 — The tasks / reminders list view

*As a rep, I want my tasks in a fast, groupable, keyboard-driven list, so that I can triage what's due today without opening each one.*

**Is this just a special case of the general view patterns? — yes, and that's on purpose (your ask).** The tasks list view is **an instance of the same saved-view system** every object gets (doc 4c Journeys 4.8–4.9): it's the Tasks object shown as a **list layout** with task-appropriate defaults (group by due-date buckets, fast keyboard actions). It is **not a separate subsystem** — it reuses the same columns/filter/sort/group engine and the same `SavedView` model. This journey only pins the **task-specific defaults and actions** on top of that shared machinery, the way Todoist/Linear specialize a generic list for tasks.

Doc 4.14 defined tasks and a "My Tasks" view. This journey makes that view **list-grade**, the way Todoist/Linear do.

1. **Grouping:** default groups are **Overdue · Today · Upcoming** (by due date); he can switch to **group-by priority** or **by type** (Call/Email/To-do) or **by linked object**.
2. **Sort:** within a group, sort by due date, priority, or created — or use **manual order** (drag to arrange).
3. **The one real gotcha (Todoist's rule):** **manual drag-order only works in the ungrouped/unsorted view.** When a group or sort is applied, drag-reorder is off and the list obeys the sort. The UI states this so it's never confusing.
4. **Fast actions, keyboard-first:** `✓` complete, `r` **reschedule** the due date (Tomorrow / Next week / Custom), `x` dismiss-the-reminder, `1–3` set priority, `@` set/deliver due date — all without the mouse (doc 4b.12 keyboard system). These keep doc 4.14's exact semantics: **Complete / Reschedule / Dismiss-reminder** — note the task action is **Reschedule, not "snooze"** ("snooze" lives only on the notification inbox, doc 4.16), the dual-model fix from your 4.14.4 feedback.

- **Benchmark (beat this):** Todoist — sort or group tasks — https://www.todoist.com/help/articles/sort-or-group-tasks-in-todoist-WFWD0hrb ; Linear — my issues / grouping
- **Build docs:** dnd-kit — sortable (manual order) — https://dndkit.com/presets/sortable ; internal — Task model (doc 4).

## Journey 4b.10 — Fit more (or less) on screen: zoom + density

*As a rep, I want to zoom the grid in or out and choose how tightly rows pack, so that I can fit a whole account on screen when scanning or open it up when reading.*

There are **two separate controls**, and this journey says exactly where each lives and what each does.

### Journey 4b.10.1 — Zoom the grid, Google-Sheets-style (your ask — replaces browser zoom)

You're right that Sheets is the benchmark; we **replace the "just use browser zoom" idea with a real in-app zoom control**, because browser zoom rescales the whole app (nav, panels, everything) and resets on reload, whereas a rep wants to zoom **just the sheet** and have it stick.
1. **Where it is:** a **zoom control in the bottom status bar of the grid** (and in the view-toolbar overflow) showing the current percentage, exactly like Google Sheets' zoom dropdown.
2. He picks a level — **50% / 75% / 90% / 100% / 125% / 150% / 200%** (or types a custom %). `Cmd/Ctrl +/–/0` are also bound to it (in-app, not the browser).
3. Zoom **scales the grid content proportionally** — font size, row height, and column widths together — so more (or fewer) rows *and* columns fit, and the account cockpit view can be shrunk to fit on one screen.
4. The zoom level is **saved per view**, so a dense cockpit view can sit at 80% while a reading view sits at 110%.

### Journey 4b.10.2 — Display density (a different control)

1. **Where it is:** a **density toggle in the view toolbar** (a row-height icon).
2. **Comfortable / Cozy / Compact** (Gmail's model) changes **row height and padding** — how tightly rows pack — independent of zoom. (Zoom scales *everything*; density changes only the *vertical breathing room*.)
3. The density choice is **remembered per user** and can differ per view; it's the same control as the table row-height in doc 4c 4.8.6.

- **Benchmark (beat this):** Google Sheets — zoom (the % control) — https://support.google.com/docs/answer/48335 ; Gmail — display density — https://support.google.com/mail/answer/8155 ; Linear — interface density
- **Build docs:** internal — a `zoom` scale factor applied to Glide's cell/row/font sizes (not browser zoom); a density token on the theme. Both saved on `SavedView.configJson`.

## Journey 4b.11 — A record page you shape, and edit without "Save"

*As an admin, I want to arrange the record page once and have every record of that object use it, and as a rep I want to edit any field in place with no "Edit/Save" dance, so that records look designed and editing is instant.*

Two asks: make the record page **customizable** (but never PhoneBurner-ugly), and make editing **instant** (never Salesforce's click-Edit-wait-Save).

### Journey 4b.11.1 — Customize the layout (the entry point + save, which was missing)

**How you get here (your ask — this was the missing part).**
1. On any record page (or its drawer), the user clicks **⋯ → Edit layout** in the top-right (also reachable from **Settings → Data model → [object] → Record layout**). This puts the page into an **"Edit layout" mode**.
2. In edit mode, fields get **drag handles**, empty **sections** appear, and a side rail lists **hidden fields** he can drag in. He arranges fields on a **constrained grid**: order them, group them into **sections he names**, and set each field's **width** (1–2 columns). Constrained = it snaps to a clean grid, so any arrangement still looks designed.
3. **Do I have to save / lock it? (your ask) — yes.** Edit mode is a distinct mode: he arranges, then clicks **Done / Save** (or **Discard**). **Outside edit mode the layout is locked**, so a rep flicking through records **cannot** accidentally drag it apart. The saved layout is **per-object and applies to everyone** (a `DetailLayout` with `isDefault`); a strong default ships so he never *has* to touch it. **[LATER]** when roles land, editing the layout becomes admin-only; today anyone can. (Attio's configurable record pages, done cleanly.)

### Journey 4b.11.2 — Edit any field with zero modal

1. He **clicks a field value → it becomes editable in place**. **Tab** moves to the next field; **Enter or click-away saves** (optimistically); **Esc** cancels. No "Edit" button, no page reload, no separate "Save".
2. **Same gesture everywhere:** the drawer (doc 4d 4.11), the full page, and the grid all use the one inline-edit behavior — learn it once. (This is *field-value* editing and is always on; it's separate from *layout* editing above, which is the locked/mode-based one.)

- **Benchmark (beat this):** Attio — configure record pages — https://attio.com/help/reference/managing-your-data/records/configure-record-pages ; contrast Salesforce inline-edit friction (the thing to beat)
- **Build docs:** internal — the DetailLayout config (below) + the shared inline-edit component.

## Journey 4b.12 — The keyboard system (discoverable and yours to change)

*As a rep, I want everything reachable by keyboard, the shortcuts easy to discover, and any page one search away, so that the app feels like Superhuman and I rarely touch the mouse.*

The whole app should feel like **Superhuman/Linear**: everything reachable by keyboard, shortcuts easy to learn, and rebindable.

1. **One palette rules them all.** `Cmd/Ctrl+K` (doc 4.12) reaches **every** action. Critically, the palette **shows each command's shortcut on the right as you find it** — so it *teaches the shortcut while you use it*.
2. **Cmd-K reaches every *page*, including settings — Spotlight-style (your 4b.12.4 ask).** The palette indexes **navigation targets**, not just actions: every object, view, list, record, **and every settings page** (e.g. type "notif" → jump straight to **Settings → Notifications**; type "keyboard" → **Settings → Keyboard**). So there's no hunting through settings menus — anything in the app is reachable by name, exactly like Apple Spotlight. (Implementation: a route registry that every page — settings included — registers into, so the palette can list and open it.)
3. **Modal single-keys in context.** When focus is on a list or record, bare keys do the frequent things — `c` compose, `e` archive, `r` reschedule (on a task), `h` snooze (on a notification), `1–3` priority, `j/k` move. Chorded shortcuts (`Cmd+…`) are reserved for global/rare or destructive actions, and **no bare key is ever bound to something irreversible**.
4. **The `?` shortcuts overlay — where it is and how you see it (your ask).**
   - **How to open it:** press **`?`** (i.e. `Shift+/`) anywhere you're **not** typing in a field. It slides up a **cheat-sheet overlay**. It's also reachable from the palette ("Keyboard shortcuts") and from a small **`⌘K` / `?` hint that sits visibly in the nav bar**, so a new user discovers it without being told.
   - **What it shows:** the shortcuts **active in the current view** (context-aware, Linear's model) grouped by area, and it's **searchable** — type "archive" to find its key. `Esc` closes it.
   - **Superhuman's guidance we follow:** Superhuman's core trick is **teaching the shortcut at the moment of use** — when you do something with the mouse, the UI shows the key you *could* have pressed, and the command palette always displays each command's shortcut beside it. We copy both: shortcut-beside-command in the palette (point 1) and a gentle "you can press `e`" hint after a mouse action. (See their write-up.)
5. **Customizable.** **Settings → Keyboard** lets him **rebind** anything, on top of sane defaults (Linear does exactly this).

- **Benchmark (beat this):** Superhuman — command palette design + teaching shortcuts — https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ ; Linear — the searchable `?` shortcuts overlay [visual] — https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help ; Linear — Preferences (what is actually user-configurable) [how it works] — https://linear.app/docs/account-preferences ; macOS Spotlight — everything reachable by name — https://support.apple.com/en-us/HT204014
- **Build docs:** cmdk — command palette — https://github.com/pacocoursey/cmdk ; internal — a route registry every page (incl. settings) registers into; a `KeyboardBinding` map (below).

## Journey 4b.13 — Formatted fields that just work (phone, email, URL) — and custom formats for everything else

*As a rep, I want values to format themselves however I paste them, and as an admin I want to set display formats and validation on my own fields, so that data looks consistent and bad values get caught.*

Strictly-formatted values should format themselves, no matter how they're pasted, and error-handle gracefully.

1. **Phone — paste anything, get the host-country format (your ask).** However he pastes it — `4155552671`, `(415) 555-2671`, `+1 415…` — the cell **auto-formats to the host country's national format** (US → `(415) 555-2671`) and stores the canonical **E.164** underneath (doc 3.14c's storage rule). While he types, it formats **as-you-type**. A **foreign** number auto-shows its international `+CC` form instead (a UK number won't be forced into US shape).
   - **Host country** = workspace setting → the user's region → browser locale (in that order).
2. **Copy out — formatted or raw (your ask).** Plain `Cmd/Ctrl+C` copies the **formatted** number (for a doc/email). A cell **copy menu** adds **"Copy raw / E.164"** (`+14155552671`) for pasting into a dialer or sheet. (Same store-canonical/display-formatted pattern applies to every normalized field.)
3. **Email — normalize + shape-check.** On paste we **trim + lowercase**, validate the *shape*, and — honestly — **defer deliverability to the enrichment verify step** (doc 7.7) and the hard-bounce dead-value path (doc 7b), because no regex can prove a mailbox exists. So entry is never blocked on "is it deliverable."
4. **URL — normalize.** `example.com` → `https://example.com` (add scheme if missing), lowercase the host, validate, and strip tracking junk (`utm_*`, click-ids) into the canonical domain (doc 7's canonical-domain rule).
5. **Error handling — accept-but-flag (your ask).** If a pasted value can't be parsed (a phone that isn't a number, a malformed email), we **keep the raw value**, outline the cell **red with a reason on hover**, and leave it editable — we **never silently discard** a paste (that infuriates bulk-import users). The failure is just an `invalid`/`unknown` entry in the universal **`{value, status, reason, source, checked_at}`** dead-value shape (doc 3.14c) — provenance kept, re-import idempotent, enrichment skips or retries it.

### Journey 4b.13.6 — Custom display formats + validation for user-defined fields (your ask — yes, we need this, and phone/email/URL are instances of it)

You asked whether we need Google-Sheets-style custom number formats and validation once users add custom objects/fields. **Yes — and rather than a separate feature, the built-in phone/email/URL formatting above becomes one *instance* of a single "field format + validation" system.** Every field carries an optional **format** (how it displays) and **validation** (what's allowed); the strict types just ship with theirs pre-filled.

1. **Where it is.** In a field's settings (doc 4.4), a **"Format & validation"** section.
2. **Display format (Sheets-style), per type:**
   - **Number / currency** — decimals, thousands separator, `%`, currency symbol/code, sign — chosen from **presets** ("1,234.56", "$1,234", "12%", "1.2k") or a **custom format string** for power users (Sheets' custom number format model).
   - **Date / timestamp** — format presets ("Aug 14, 2026", "2026-08-14", "14/08/26", relative "3 days ago").
   - **Text** — optional casing/trim normalization.
   Formatting is **display-only** — the stored value stays canonical (the store-canonical/display-formatted rule from step 2), so exports and the API get clean values.
3. **Validation, per type:**
   - **Number/currency/date** — min / max / allowed range.
   - **Text** — a **pattern** (regex or a simple mask like `AAA-000`) with a human message.
   - **All types** — required / unique (doc 4.4).
4. **On entry (the rep's journey):** he types or pastes a value → it **displays in the field's format**, and if it **fails validation** it uses the **accept-but-flag** behavior from step 5 (keep the raw value, red outline, reason on hover) — or **hard-blocks** if the admin marked the rule strict. So validation reuses one path, whether the field is a built-in phone or a custom "Contract #" mask.
5. **The unifying point:** phone, email, and URL are simply **built-in field types whose format+validation are pre-configured** (libphonenumber-js, shape-check, normalize-url). Custom fields use the **same `format`/`validation` config** on `AttributeDef` — so there's one system, not two, and adding a new strict type later is just seeding its defaults.

- **Benchmark (beat this):** Google Sheets — custom number formats — https://support.google.com/docs/answer/56470 ; Google Sheets / Excel — data validation + error flags ; Airtable — phone/email/URL field types — https://support.airtable.com/docs/supported-field-types-in-airtable-overview
- **Build docs:** libphonenumber-js (MIT) — https://github.com/catamphetamine/libphonenumber-js ; normalize-url — https://github.com/sindresorhus/normalize-url ; `Intl.NumberFormat` / `Intl.DateTimeFormat` for number/date formatting; internal — `format` + `validation` on `AttributeDef` (doc 4), one validator path shared with strict types.

## Journey 4b.14 — Sort or filter by a multi-value column (the "how should we rank this?" journey)

*As a rep, I want to sort or filter by a column that holds many values — rank accounts by their newest activity, or filter to accounts with an open deal — so that a dense cockpit view can still be ordered meaningfully.*

You flagged that there are lurking user journeys here; here is the one that surfaces. Sorting a table by a **multi-value** column (like "Activity", which holds many calls/emails per row) is ambiguous until the app knows **which value to rank on** — so we ask, once, in plain language.

1. He clicks **Sort → Activity** (a multi-value column). Because each cell holds many values, a small **"How should we rank this?"** picker appears with the choices that make sense for the sub-field type:
   - for a **date** sub-field: **Newest / Oldest**,
   - for any list: **Count**, **First**,
   - for a **number** sub-field: **Sum / Max / Min / Average**.
2. He picks **"Newest activity date"** → the table sorts companies by their most recent touch. The chosen reduction is **remembered on the column**, so he picks it only once.
3. **Filtering works the same way:** "Activity → newest date is before 30 days ago" filters to **stale accounts**; "Deals → count is greater than 0" filters to **accounts with an open deal". The filter builder (doc 4c 4.8.3) shows the same reduction picker when the chosen field is multi-value.
4. **Grouping** by a multi-value column likewise asks for the reduction (group companies by "newest activity month").

- **Benchmark (beat this):** Notion — rollups (forces you to pick the reduction) — https://www.notion.com/help/rollup-properties ; Airtable — rollup field
- **Build docs:** internal — a required `reduce` on any multi-value column in `GridView.columnsJson`; sort/filter/group compile against the reduced scalar (server-side, doc 4c Decision 2).

## Journey 4b.15 — Hide, group, and collapse columns

*As a rep, I want to hide columns I don't need and gather related ones into collapsible groups, so that a wide cockpit view stays readable and I can fold away what I'm not using.*

Three related controls keep a wide grid manageable:

1. **Hide a column.** From the **Fields** button in the view toolbar (doc 4c Journey 4.8.1) he toggles a column off; the data is untouched, the column just isn't shown. (Defined in 4c; noted here because it's part of the same "tame a wide grid" workflow.)
2. **Group columns into a named group.** He selects adjacent columns → **⋯ → Group columns** → names it ("Account info", "Activity"). A **group header bar spans those columns** above the normal header row:
   ```
   │      Account info  ▾      │        Activity  ▾        │  Deals │
   │ Company │ Website │ Size  │ Last call │ Last email    │  …     │
   ```
3. **Collapse / expand a group.** Clicking the group header's **▾** collapses the group to a **single summary column** (or a thin spacer), so he can fold "Activity" away while focused on "Account info," and expand it again with one click. Collapsed/expanded state is **saved per view**.
4. **Reorder groups** by dragging the group header; columns move with their group.

- **Benchmark (beat this):** Airtable — hide fields — https://support.airtable.com/docs/hiding-fields-in-airtable ; AG Grid — column groups (collapsible) — https://www.ag-grid.com/react-data-grid/column-groups/ ; Notion — column visibility
- **Build docs:** Glide Data Grid — column groups (`group` on columns) — https://docs.grid.glideapps.com/api/dataeditor/columns ; state saved on `GridView.columnsJson` (a `group` + `collapsed` per column).

---

## Background jobs

- **(reuses E-series from doc 4)** — the multi-object grid view (4b.1) reads the doc-4a activity feed (E5) and normalized tables; it caches per view and invalidates on child writes.
- **AI columns** run on doc 7's H2/H3 runners — see **doc 4g**.
- **No new background jobs are introduced by this doc** — it's mostly client interaction + view definitions over existing engines.

---

## Decisions for you (power views & speed)

**1. Multi-object grid — nested-list cells as the default, fan-out as an option. Decided (my pick).** The default keeps **one row per parent** with multi-child columns rendered as bounded, sorted, truncated **lists inside a cell** — this avoids row-explosion and matches the "account cockpit" you described. **Fan-out** (one row per child, parent repeats as greyed merged cells) is available per view when you truly want the spreadsheet-report shape. *Alternative: fan-out always — rejected; it explodes rows and makes the common view noisy.*

**2. Optimistic updates — yes, but scoped. Decided (my pick, you asked "unless you disagree").** Optimistic for **reversible, client-predictable** edits (cells, status, notes, task-complete, drag-order). **Pessimistic (show a real pending state, no fake success)** for **irreversible or server-computed** results — sends (email/SMS), enrichment/AI output, deletes, anything with money. *Alternative: optimistic everywhere — rejected; it would flash a fake AI value or "sent" state that can then vanish, which erodes trust.*

**3. Row reorder under a sort — disable drag while sorted. Decided (my pick).** A manual hand-order and an active sort contradict each other, so when a sort is on, drag is off with a one-line "clear sort to reorder" hint (Todoist's proven rule). *Alternative: let a drag silently clear the sort — rejected; too surprising.*

**4. Record-page customization — constrained grid, not free canvas. Decided (my pick).** Arrange fields/sections/widths on a snapping grid so every layout stays clean; ship strong defaults. *Alternative: PhoneBurner-style free placement — rejected; it's why PhoneBurner looks the way it does.*

---

## Technology choices (where it is not obvious)

- **The grid stays Glide Data Grid (doc 4c §A).** Research confirmed it ships ~70% of Sheets mechanics natively — keyboard nav, range/Shift/Ctrl selection, the editor overlay, copy (`getCellsForSelection`) + TSV paste (`onPaste`), the fill-handle indicator, `onColumnMoved`, row markers, custom cell renderers, and **per-cell `themeOverride`** (which we reuse for both conditional colors *and* AI-provenance tinting). We build the rest: type-to-replace, Enter/Tab commit-navigation, Esc-revert, fill-value computation, the undo stack, sort/filter, and the reorder-under-sort reconciliation.
- **Natural-language dates — chrono-node** (MIT). Parses "tomorrow / next tue / friday 1pm" for the `@date` picker; the standard JS library for this.
- **Optimistic writes — a local edits map layered over server data, reconciled with TanStack Query** (`onMutate` snapshot → `onError` rollback → `onSettled` invalidate). Because Glide reads cells from our own state via `getCellContent`, the simplest correct path is a per-row edits overlay cleared on confirm / rolled back on error.
- **Command palette — cmdk; drag — dnd-kit; conditional color + provenance tint — Glide `themeOverride`.** All already in the doc-4 stack; no new heavy dependency.
- **The denormalized grid is a query engine, not a new store.** It reuses the normalized CRM tables and the doc-4 activity feed (E5). The view definition (resolvers, reductions, sort, type-priority, templates) is JSON config — see the data model.

## Data model (Prisma) — additions in this doc

Extends doc 4. **New models marked `// NEW`.** The multi-object grid, color rules, dropdown labels, detail layouts, and key bindings are all **configuration** — they describe how existing normalized data is shown and edited; they don't store denormalized rows. *(The `AiColumn` model moved to doc 4g.)*

```prisma
model GridView {              // NEW — a multi-object grid view (Journey 4b.1)
  id           String  @id @default(cuid())
  workspaceId  String
  name         String
  rootObjectId String            // e.g. Companies
  isTemplate   Boolean @default(false)
  columnsJson  Json              // ordered columns; each: { source path, kind, template?,
                                 //   reduce? (newest|oldest|count|first|sum|max|min|avg), sort?,
                                 //   limit? (visible N, 4b.14), fanOut? (bool),
                                 //   group?, collapsed? (column groups, 4b.15),
                                 //   shape? (horizontal|vertical|combination), chips?[]
                                 //     (composite config — defined in doc 4f) }
  zoom         Float?  @default(1)  // Sheets-style zoom, saved per view (Journey 4b.10.1)
  createdAt    DateTime @default(now())
}

model ColorRule {             // NEW — conditional formatting on a view (Journey 4b.4)
  id          String  @id @default(cuid())
  viewId      String            // SavedView or GridView
  attribute   String            // field the rule keys off
  predicate   Json              // { op: before_today|is_today|after_today|eq|gt|lt, value? }
  target      String            // background | text | dot
  scope       String  @default("cell") // cell | subvalue — color the whole cell or just the matching chip (4b.4)
  color       String
  sortOrder   Int               // first match wins
  isDefault   Boolean @default(false) // seeded default rule (e.g. due-date temperature) — editable, restorable
  enabled     Boolean @default(true)  // user can toggle a default rule off (4b.4)
}

// Dropdown option shape (extends doc 4 AttributeDef.optionsJson) — no new table:
// optionsJson: [{ value: "closed_won", label: "Closed — Won 🎉", color: "#16a34a", order: 0 }, ...]
//   • value  = stored / filtered / exported / API  (Journey 4b.5)
//   • label  = what the rep sees (may differ from value)
//   • color  = chip color, on by default

// AiColumn model moved to doc 4g (AI Columns).

model DetailLayout {          // NEW — per-object record-page layout (Journey 4b.11)
  id          String  @id @default(cuid())
  workspaceId String
  objectId    String
  sectionsJson Json             // [{ name, fields:[{slug, width:1|2}], order }] on a constrained grid
  railObjectsJson Json?         // which related objects show in the Related rail, ordered (doc 4a.9)
  feedKindsJson   Json?         // which activity kinds show in the Activity feed, ordered (doc 4a.9)
  isDefault   Boolean @default(true)
}

model KeyboardBinding {       // NEW — per-user shortcut overrides (Journey 4b.12)
  id        String @id @default(cuid())
  userId    String
  actionId  String             // e.g. "compose", "archive", "priority.high"
  keys      String             // e.g. "c", "mod+shift+a"
  @@unique([userId, actionId])
}

model NoteLink {              // NEW — a note ↔ record link, MANY-TO-MANY (doc 4.13 edit)
  id       String @id @default(cuid())
  noteId   String
  objectId String              // which object kind
  recordId String              // the target
  @@index([recordId])
  @@unique([noteId, recordId])
}
```

*(`NoteLink` lives here rather than re-opening doc 4's schema block; doc 4's `Note.recordId` stays as the optional primary attach point, and `NoteLink` adds the extra links that make a note many-to-many.)*

## Technical decisions, trade-offs & edge cases

**The multi-object grid (Journey 4b.1) — hard cases and our rules.**
- **Editing a repeated parent cell.** When Company repeats across 5 rows and he edits it in one, we **write through to the single underlying company** and re-render all repeats. Repeated cells are visually marked (greyed/merged) so it's obvious they're shared — this prevents the silent divergence Airtable-style denormalizing causes.
- **A cell with many children / sorting-filtering a multi-value column.** Which children show (top N by the column's sort, default newest-first), that N is per-column, and the "how should we rank this?" reduction picker are specified in **Journey 4b.14** and **doc 4f.7**. 200 is not a cap; we just don't render them all.
- **The Activity cell reads the doc-4a feed.** It shows `CompanyActivity` rows (job E5) filtered to the row's company, already merged across all `kind`s (call/email/text/…) and newest-first — so there's no per-cell union query and no conflict with doc 4a (Journey 4b.1). Adding a new activity type = a new `kind`.
- **CSV export of a multi-object grid.** A "Deal — Owner" list cell has no clean flat form. We default to **explode-to-one-row-per-child on export** (lossless, re-importable), with an option to **join list items with a delimiter** into one cell (compact but lossy). We state which, so the export never silently differs from the screen.
- **Composite-cell specifics** (chips, sub-cursor navigation, edit-through, safe delete, null-key sort, a record under two parents) live in **doc 4f**.

**Optimistic updates (Decision 2) — the precise rule.** Optimistic = write local state immediately, reconcile, roll back on error (the TanStack pattern). We apply it only where the outcome is **reversible and client-predictable**. It is **wrong** for: payments/anything with money, permanent deletes, auth changes, and **server-computed values** (an AI/enrichment result — we can't predict it, so we show a pending spinner, never a fake value). This keeps speed where it's safe and honesty where it matters.

**Paste/fill guards (Journey 4b.3).** Three edge cases from the grid research: (1) a **paste bigger than the selection** grows to the clipboard's shape (adds rows if needed); a single value **tiles**. (2) A paste/fill **into a read-only or AI column** is blocked or skips those cells — never overwrites computed data, never re-marks an AI cell as human without clearing provenance. (3) **Row reorder returns a *view* index** — under a sort or filter we map the visible drop position back to the real `position` in the full dataset (or disable drag while sorted, per Decision 3); we never mutate by view index.

**1-to-many vs many-to-many — which relations are which (your "think carefully" ask).**
- **Many-to-many:** **Note ↔ records** (`NoteLink` — a call note can attach to several people/the deal); **Deal ↔ People** (a deal has several contacts, a person is on several deals); **Task ↔ records** (`TaskLink`, doc 4); **List ↔ records** (a record in many lists). These are join tables so either side can have many.
- **One-to-many:** **Company → People** (a person has one primary company); **Call → Person** (a call is with one person, though it can *link* to more via the same join pattern if needed); **Person → owner (User)**.
- **The rule:** if either side can legitimately point at *several* of the other and you need to query from both directions, model it as a **join table** (M-M), not a scalar reference. Reference fields (doc 4.3) already allow multi-value on one side; promote to a join table when *both* sides are many. Getting this right at the schema level is why "attach one call note to two people" is a config detail, not a rebuild.

**Keyboard bindings (Journey 4b.12).** Defaults live in code as an `actionId → keys` map; a user's overrides are `KeyboardBinding` rows merged on top at load. The `?` sheet and the palette both read the merged map, so a rebind shows up everywhere at once. Destructive actions are flagged in the action registry and refused a bare-letter binding.
