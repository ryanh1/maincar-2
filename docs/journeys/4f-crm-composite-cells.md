# Doc 4f — Composite Cells

Part of the **CRM Data & Views** family (head: [4 — Objects, Fields & Schema](4-crm-data-and-views.md); grid & editing in [4b](4b-power-views-editing-and-keyboard.md), AI columns in [4g](4g-crm-ai-columns.md), the multi-object grid in [4b Journey 4b.1](4b-power-views-editing-and-keyboard.md)).

**What this doc covers.** Unlike Google Sheets, one cell in our grid can hold **more than one value**, and those values can be **chips** (a colored date chip, a status chip with a dropdown) sitting next to plain text. This is what makes an "account cockpit" row possible (doc 4b.1). This doc is every journey for **building, reading, navigating, editing, and deleting inside a composite cell** — safely, so a dense view is still editable without fear.

**It was split out of doc 4b** (was Journey 4b.2a) because it grew into its own feature with its own CRUD and keystrokes.

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the technical page.

---

## Journey 4f.1 — The three composite shapes (and chips inside a cell)

*As a rep, I want a single cell to show several related values — a date next to a disposition, or a stack of people — so that I can see an account's shape at a glance in one row.*

We support **three shapes**, plus chips.

1. **Horizontal composite** — several fields on one line, joined by a template `{{a}} — {{b}}`:
   ```
   Aug 14 · Connected
   ```
2. **Vertical composite** — several child records stacked:
   ```
   • Dana Reeve
   • Omar Reyes
   • Priya Shah
   ```
3. **Combination** — a vertical list *of* horizontal composites (each sub-row is a template):
   ```
   Aug 14 · Connected
   Aug 12 · Voicemail
   Aug 09 · No answer
   ```

**Chips inside a cell.** A sub-value can render as a **chip** instead of text: an **activity date** as a date chip, a **disposition/stage** as a **status chip with a dropdown** (like a Google Sheets in-cell dropdown), or plain **text**. So the combination example is really `[date-chip] · [status-chip ▾]` per sub-row.

- **Benchmark (beat this):** Airtable — linked-record (multi-value) cells — https://support.airtable.com/docs/linked-record-field ; Google Sheets — in-cell dropdown chips — https://support.google.com/docs/answer/13951556 ; Notion — multi-property cells
- **Build docs:** Glide Data Grid — custom cell renderers — https://docs.grid.glideapps.com/api/dataeditor/custom-cells

## Journey 4f.2 — Configure a composite column (create)

*As a rep, I want to build a composite column by choosing its shape and which fields become chips, so that the view shows exactly the mash-up I need.*

1. **Entry point.** On a **multi-object grid view** (doc 4b.1), he clicks the header **`+` → Add column → Composite** (or edits an existing column's ⋯ → **Edit column**).
2. A **configuration panel** slides in from the right — **fully tab-navigable** (`Tab`/`Shift+Tab` between controls, `Enter` to confirm; no mouse needed):
   ```
   ┌─────────── Composite column ───────────┐
   │ Column name   [ Activity           ]   │
   │ Shape         ( Combination ▾ )        │  ← Horizontal | Vertical | Combination
   │ Source        ( Calls + Emails ▾ )     │  ← which object(s) feed the rows
   │ Row template  [ {{date}} · {{dispo}} ] │  ← the horizontal line per sub-row
   │ Render as chips:                       │
   │    {{date}}   [x] date chip            │
   │    {{dispo}}  [x] status chip ▾        │
   │ Sort          ( Newest first ▾ )       │
   │ Show up to    [ 5 ] items  (4f.7)      │
   │ [ Preview ]                 [ Save ]   │
   └─────────────────────────────────────────┘
   ```
3. He picks the **shape**, the **source object(s)**, a **row template** for horizontal parts, ticks **which sub-fields render as chips** (and which chip type), sets **sort** and a **visible limit**, then **Save**.
4. The column appears, drawing each row's composite from the underlying records (read-time, doc 4b.1 — nothing is stored flattened).

**Edge cases in this step:** if the template references a field that doesn't exist on the source, the panel flags it before save; if two sources have different fields, only shared/mapped fields are offered as chips; an empty source shows an empty cell, not an error.

- **Benchmark (beat this):** Clay — array/lookup column config — https://university.clay.com/docs/lookup-rows ; Sigma — join-grid column setup — https://help.sigmacomputing.com/docs/working-with-pivot-tables
- **Build docs:** internal — extends `GridView.columnsJson` with `{ shape, source, template, chips[], sort, limit }` (doc 4b data model).

## Journey 4f.3 — Move around inside a composite cell (the sub-cursor)

*As a rep, I want to move value-by-value inside a packed cell, so that edits and deletes hit exactly one thing, never the whole cell.*

When the rep enters a composite cell, a **sub-cursor** appears that moves **one sub-value at a time** — this is the safeguard that makes deleting safe.

1. **Enter the cell:** `Enter` (or a click) focuses the **first sub-value**; a click lands directly on the sub-value clicked (hit-testing).
2. **Move:** **horizontal** composite → `←/→` (and `Tab`/`Shift+Tab`) move between sub-values on the line; **vertical/combination** → `↑/↓` move between sub-rows, `←/→` within a sub-row.
3. **Leave:** `Esc` drops the sub-cursor and returns to the normal grid cursor, so he's never "trapped" in a cell.

- **Benchmark (beat this):** Google Sheets — cell navigation feel — https://support.google.com/docs/answer/181110
- **Build docs:** internal — the sub-cursor + hit-testing over Glide overlay editors.

## Journey 4f.4 — Edit a sub-value (edit-through to the real record)

*As a rep, I want editing a chip in a cockpit view to change the real underlying record, so that I don't keep a second, diverging copy.*

1. He focuses a sub-value (4f.3) and edits it in place:
   - a **status chip** → `Enter`/click opens the **status options dropdown** (doc 4b.7);
   - a **date chip** → opens the **date picker** (doc 4b.7);
   - **text** → type-to-edit.
2. The write goes **through to the underlying record** — editing the disposition chip in a company-cockpit row edits **that Call's disposition**, because composites are a *view* of normalized data (doc 4b.1), never a copy.
3. **Optimistic** for reversible edits, with rollback on failure (doc 4b Decision 2).

- **Benchmark (beat this):** Sigma — edit-through on a join grid ; Airtable — edit a linked record inline
- **Build docs:** internal — per-sub-value edit-through resolver → the source record's field.

## Journey 4f.5 — Add an item to a vertical/combination cell

*As a rep, I want to add a person or an item to a stacked cell quickly, so that I can build the account without leaving the row.*

1. A subtle **`+` add-row** sits at the bottom of the cell (visible on hover / when the sub-cursor is in the cell).
2. He clicks it (or presses **`Cmd/Ctrl+Enter`** with the sub-cursor in the cell) → an **inline `@`-picker** opens to add a **related record** (add a person to the list), or a **blank sub-row** for a brand-new child.
3. The new item is written to the underlying relation/record and appears in the cell.

- **Benchmark (beat this):** Airtable — add a linked record from the cell — https://support.airtable.com/docs/linked-record-field
- **Build docs:** internal — reuses the `@`-picker (doc 4b.7) + relation write.

## Journey 4f.6 — Delete inside a composite cell (the "don't nuke everything" safeguard)

*As a rep, I want deleting one value in a packed cell to remove only that value — and removing a whole item to ask me first — so that I never accidentally destroy a record while tidying a cell.*

1. `Delete`/`Backspace` on a **focused sub-value** clears **just that value** (e.g. blanks the disposition), **not** the whole cell.
2. To remove a **whole child item** from a vertical/combination cell, he focuses the sub-row and presses **`Cmd/Ctrl+Delete`** (or right-click → **Remove item**).
3. Because that can mean two very different things, the app **asks, explicitly**:
   - **Remove from this list** — unlink the relationship (the default, safe) — the record still exists.
   - **Delete the record** — destroy the underlying Person/Call (the dangerous option) — with a confirm.
4. A single `Delete` **never** removes a child record. (This is the direct answer to "will the user click delete and lose everything?" — no.)

- **Benchmark (beat this):** Airtable — remove vs delete a linked record (unlink is default) — https://support.airtable.com/docs/linked-record-field
- **Build docs:** internal — the remove-item action offers unlink vs delete; delete routes through the doc-4 archive/trash rules.

## Journey 4f.7 — Copy, paste, fill, and the visible limit

*As a rep, I want copy/paste and fill to behave sensibly on packed cells, so that bulk work doesn't corrupt them.*

1. **Copy out (`Cmd/Ctrl+C`):** copies the cell's **display text** (e.g. `Aug 14 · Connected`) as plain/TSV text, so it pastes cleanly into Excel/Sheets or an email.
2. **Paste into a composite column — what "paste TSV" means (you asked, plainly):** *TSV* = the tab/newline-separated block you get when you copy cells out of Excel or Google Sheets. Because a composite cell is a **view of underlying records** (not a free text box), we **do not try to rebuild records from a pasted block.** Instead:
   - a paste lands in the **focused editable sub-value** as text (e.g. paste a disposition into the disposition sub-value);
   - a **multi-line** paste maps to **successive sub-rows** *only where those sub-values are directly editable* (like the disposition column);
   - anything it can't place (you can't paste text and have it *create* a Person) is **rejected with a one-line reason**, never silently dropped.
3. **Fill-down (`Cmd/Ctrl+D`):** fills an editable **sub-value** down a range, but **cannot fabricate child records** — filling a "people" list down is blocked with a reason (you can't clone relationships by dragging).
4. **Visible limit + "show N more":** a cell shows the top **N** items by the column's sort (default newest-first); **N is a per-column setting** (4f.2), and **"show N more"** opens the full list in a drill-in. There's **no cap on how many children exist** — we just don't render them all (a fetch guard paginates the drill-in). *(This is the "200 children" rule.)*

- **Benchmark (beat this):** Google Sheets — copy/paste + fill behavior — https://support.google.com/docs/answer/181110
- **Build docs:** Glide Data Grid — copy/paste — https://docs.grid.glideapps.com/extended-quickstart-guide/copy-and-paste-support

---

## Keystroke reference (plain cell vs. composite cell)

| Key | Plain cell | Inside a composite cell (sub-cursor) |
|---|---|---|
| `Enter` | commit + move down | enter the cell / open the focused chip's editor; on a link, open the record |
| `Esc` | cancel edit | drop the sub-cursor, return to the grid cursor |
| `←/→` | move cell left/right | move within a horizontal line |
| `↑/↓` | move cell up/down | move between sub-rows (vertical/combination) |
| `Tab` / `Shift+Tab` | move cell right/left | next/prev sub-value on the line |
| type a char | type-to-replace | type-to-replace the **focused sub-value** only |
| `Delete`/`Backspace` | clear cell | clear the **focused sub-value** only (never the whole cell) |
| `Cmd/Ctrl+Enter` | (n/a) | **add** an item to a vertical/combination cell (4f.5) |
| `Cmd/Ctrl+Delete` | (n/a) | **remove the focused child item** (asks unlink vs delete — 4f.6) |
| `Cmd/Ctrl+C / V` | copy/paste TSV | copies display text; paste targets the focused sub-value (4f.7) |
| `Cmd/Ctrl+D` | fill down | fills an editable sub-value down; can't fabricate records (4f.7) |

## Technical decisions, trade-offs & edge cases

- **Composites are read-time views, never stored flat** (doc 4b.1). A composite cell is rendered by resolving the underlying normalized records at read time; edits write back through to those records (4f.4). This is why there's no "denormalized composite" table.
- **Interactive sub-cells are the main build risk** (doc 4b.1 re-analysis): a status dropdown inside a sub-row needs custom hit-testing + an overlay editor on the canvas grid. If it proves too heavy on Glide, composite-heavy views fall back to react-datasheet-grid (DOM) per doc 4b.1.
- **A record linked to two parents** (a note on two people) appears **under each**, once per parent.
- **Null sort keys** (an item with no date) sort **last**.
- **Editing through a repeated-parent cell** (the same company shown on 5 rows) writes once to the underlying company and re-renders all repeats (doc 4b.1).
