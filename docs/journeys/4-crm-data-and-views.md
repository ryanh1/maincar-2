# Doc 4 — Objects, Fields & Schema

The foundation of the CRM: **objects, field types, references, field rules, field history, and the standard objects.** This is the head of the **CRM Data & Views** family. The old single doc 4 got long, so it is split into six short docs (journey numbers are stable across the split, so cross-references still resolve):

- **4 — Objects, Fields & Schema** *(this doc)* — **Journeys 4.1, 4.1a, 4.2, 4.3, 4.4, 4.5, 4.6, 4.6a.**
- **[4a — Relations & Related Records](4a-crm-relations-and-related-records.md)** — the "calling Person A, show me the whole Acme picture" UX. (Referenced from Journey 4.11.)
- **[4b — Power Views, Editing & Keyboard](4b-power-views-editing-and-keyboard.md)** — multi-object denormalized tables, Sheets-grade editing, color rules, rich dropdowns, AI columns, @/-commands, density, inline-edit record pages, keyboard.
- **[4c — Tables, Views & Lists](4c-crm-tables-views-lists.md)** — the grid, view setup (columns/filter/sort/group), saved views + kanban, lists. **Journeys 4.7–4.10** + §A (spreadsheet-grade table).
- **[4d — Records, Notes, Tasks & Mentions](4d-crm-records-notes-tasks.md)** — record page/drawer, notes, tasks, @mentions. **Journeys 4.11, 4.13, 4.14, 4.15.**
- **[4e — Search, Command Palette, Notifications & Attention](4e-crm-search-notifications-attention.md)** — global search + palette, full-text search, the notification inbox, attention status. **Journeys 4.12, 4.16, 4.17, 4.18** + §B (notifications engineering).
- **[4f — Composite Cells](4f-crm-composite-cells.md)** — cells that hold several values/chips, and how you build/navigate/edit/delete inside them. **Journeys 4f.1–4f.7.**
- **[4g — AI Columns](4g-crm-ai-columns.md)** — a column whose cells run an AI instruction you write. **Journeys 4g.1–4g.7** + example instructions.

Benchmark for the family is **Attio**, with **Airtable** for the grid and **Linear** for notes/inbox.

**Phase note:** phase tags are a draft. We re-sequence together later.

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the page that tells the coding agent how to build it. The engineering, schema, and decisions for *this* doc are at the **bottom** (Background jobs · Decisions · Data model · Technical decisions).

---

## Terminology: two axes, so words stop overlapping (your ask)

Your feedback was right that "standard object" and "action" were each doing two jobs. We now use two independent axes. An object sits somewhere on each.

**Axis 1 — who defined it: standard vs custom.**
- **Standard** = the app ships it, seeds it, and writes to it, and other features depend on it (People, Companies, Deals, Calls, Emails, Texts, Meetings, Tasks). We guarantee it exists.
- **Custom** = the user invents it at runtime (e.g. "Partners"). Only they read/write it.

**Axis 2 — where it lives: first-class vs supporting.**
- **First-class object** = it gets a **left-navbar link, its own table, records, and saved views** (People, Companies, Deals, Calls, Emails, Texts, Meetings, Tasks, and every custom object).
- **Supporting data model** = it does **not** get a navbar link; it always hangs off a first-class record and is shown inside that record (Recording, Transcript, Summary from doc 2; PhoneNumber, EmailAddress, SmsMessage rows; PipelineStage). These are still standard (app-seeded), they just are not top-level.

So "standard" answers *who made it*; "first-class" answers *does it get a table in the navbar*. Recording/Transcript/Summary are **standard supporting** models — that is why they never appeared in the navbar list and are not a contradiction.

**"Activity" vs "Task" — the two things "Action" used to blur (your ask).** There are two genuinely different concepts, so they now get two names and the word "Action" is retired as an object name:
- An **Activity** is *something that happened* — a logged instance of engagement: a **Call, Email, Text (SMS), Meeting**, and later a LinkedIn message or a stage change. Activities are past-tense records; they populate the activity timeline (Journey 4.11) and the reporting in doc 5.
- A **Task** is *something to do* — a to-do / reminder with an **assignee and a due date** (Journey 4.14). Tasks are future-tense.

The object formerly labeled "Actions (tasks)" is now simply the **Tasks** object. (The command palette still has an "Actions" group — meaning "commands you can run" — which is a different, unambiguous sense in that surface; Journey 4.12.)

## Standard first-class objects that ship day 1

**People, Companies, Deals (with pipeline stages), Calls, Emails, Texts (SMS), Meetings, Tasks.** Users and Workspaces exist too but stay single-user for now.

- **People, Companies, Deals, Tasks** — full CRUD lives in this family (fields here; records in 4c/4d).
- **Calls** — the real `Call` table is defined in docs 2–3 and *surfaced* as a first-class object here (adapter, not a rebuild).
- **Emails, Texts, Meetings** — these are **first-class objects from day 1** (navbar link + table + timeline entries), so a rep can browse "all emails" or "all meetings" like any object. Their **compose/send/sync journeys live in doc 5** (comms); this doc only makes them first-class objects and wires their relations and their timeline entries. We list them as standard objects here so the data model, relations, and timeline are complete — answering your "why isn't email/SMS/calendar a standard object" directly: they now are.

Their schemas (fields + relations) are defined in Journey 4.6 and in the data model at the bottom. **Deals ships with a pipeline-stage config** (your global edit).

## New surfaces the family adds

- **Left navbar object links:** People, Companies, Deals, Calls, Emails, Texts, Meetings, Tasks. *(this doc)*
- **Object table view:** the spreadsheet-style grid — *doc 4c* (§A).
- **Record detail page + right-side drawer** — *doc 4d* (4.11) + relations *doc 4a*.
- **Lists page:** saved subsets of an object, with list-only fields — *doc 4c* (4.10).
- **Command palette** + **global search** + a top-bar search box — *doc 4e* (4.12).
- **Full-text (body) search** — *doc 4e* (4.17).
- **Settings → Data model:** the object and field editor — *this doc* (4.1–4.6a).
- **Notifications inbox** + **My Tasks** view — *doc 4e* (4.16) + *doc 4d* (4.14).

---

## Journey 4.1 — Define a custom object

*As an admin, I want to define a new custom object with its own fields, so that I can track a kind of thing the CRM doesn't ship with (like Partners or Properties).*

1. The user goes to Settings → Data model → **New object**.
2. He types a name (e.g. "Partners"), a slug, and an icon.
3. He adds fields (Journey 4.2). Each object keeps a stable id and a human-readable slug.
4. He saves. The object appears in the left navbar with an empty table.
5. He can edit the schema later. Archiving or deleting the whole object is a separate, guarded flow — **Journey 4.1a**.

- **Benchmark (beat this):** Attio — create and manage custom objects — https://attio.com/help/reference/managing-your-data/objects/create-and-manage-custom-objects
- **Build docs:** Attio API — create an object (data-shape reference) — https://docs.attio.com/rest-api/endpoint-reference/objects/create-an-object

## Journey 4.1a — Archive or delete a custom object (a dangerous action, heavily guarded)

*As an admin, I want to retire a custom object I no longer use so that my workspace stays clean — but with enough guardrails that I can never wipe out important data or break a standard object by accident.*

You flagged that deleting a whole object is very dangerous. It is: one object can hold thousands of records that other objects reference. So the flow is deliberately slow and reversible, and standard objects are protected outright.

1. **Entry point.** In Settings → Data model, the user opens a **custom** object and clicks **⋯ → Archive object** (or **Delete object**). *For a **standard** object these controls do not exist at all* (see step 6) — you can never archive or delete People, Companies, Deals, Calls, Emails, Texts, Meetings, or Tasks.
2. **Archive first (the safe default).** **Archive** hides the object and its navbar link, keeps every record and reference intact, and can be **un-archived** at any time. This is the recommended path and the first button offered. Nothing is destroyed.
3. **Delete (the destructive path) shows an impact summary before anything happens.** If the user chooses Delete, a **confirmation modal** states the blast radius in plain numbers: *"Partners holds **1,240 records**. **312 records in 3 other objects reference it** (People → Partner, Deals → Partner). Deleting removes the object, its 1,240 records, and clears those 312 references."* The modal lists which objects reference it so the impact is never a surprise.
4. **Typed confirmation.** To enable the red **Delete** button the user must **type the object's name** (GitHub's "type the repo name" pattern). This blocks a reflexive click-through.
5. **What delete actually does.** Delete is a **soft delete into the 30-day trash** (job E6), not an instant wipe — so a mistake is recoverable for 30 days from Settings → Trash. Hard-delete after 30 days honors the relation rules in *Technical decisions → Delete & archive* (required references block the sweep; optional references are nulled and logged).
6. **Standard objects are protected, not deletable.** A standard object has **no archive/delete control** because the app's own code depends on it (the dialer needs Deals, reporting needs Calls, etc.). The most a user can do to a standard object is **hide its navbar link** and **archive individual fields** (Journey 4.6a) — never remove the object. If a hidden standard object is needed again, unhiding restores the link.
7. **Roles.** Today this is single-user, so anyone can do it. **[LATER]** when roles land (doc 11.4), archive/delete/restore of an object become **admin-only**; noted here so the permission check has a home.

- **Benchmark (beat this):** GitHub — delete-a-repository confirmation (typed-name + impact); Attio — archiving objects (safe-hide model) — https://attio.com/help/reference/managing-your-data/objects/create-and-manage-custom-objects
- **Build docs:** internal — `ObjectDef.isArchived` + `deletedAt` on the object; the trash sweep is job E6.

## Journey 4.2 — Add and configure fields

*As an admin, I want to add fields of the right type to an object, so that each piece of data is captured, validated, and displayed correctly.*

1. On an object, the user clicks **Add field**.
2. He picks a type: text, number, checkbox, date, timestamp, phone, email, website, select, multi-select, currency, rating, status, location, or record-reference (Journey 4.3).
3. **For select / multi-select, he defines the option list.** Each option is one choice on the dropdown, and he sets its **stored value**, its **display label**, its **color**, and its **order** (the full option editor is Journey 4b.5).
   - **All options of one field share one data type — confirmed (your ask).** A select field's options are *not* separately typed. Every option is a value of the **same** field, so the field has exactly one type (a string enum under the hood); the stored value of every option is a short string/code, and the multi-select simply stores an array of those codes. There is no per-option "data type" to set, and there could not be one without breaking filtering, grouping, and export — which all assume the column is one type. So: you define the *options*, not a type per option.
   - **Colors — a curated default palette plus a custom picker (your ask).** When he adds options, each one is **auto-assigned a color from a built-in palette that is designed to match our app's color scheme** (so an untouched select field already looks good). He can **change any option's color** from that palette, and he can **add a new custom color** (hex / eyedropper) when the palette isn't enough. New custom colors are saved to the workspace palette so he can reuse them. (Same picker, detailed, in Journey 4b.5.)
   - For **currency**, he sets the currency code. For **email / phone / website**, format validation turns on (Journey 4b.13).
4. He sets a name, slug, and icon.
5. He can edit, reorder, or **archive** a field later.

- **Benchmark (beat this):** Airtable — supported field types — https://support.airtable.com/docs/supported-field-types-in-airtable-overview ; Airtable — single-select colored options — https://support.airtable.com/docs/single-select-field
- **Build docs:** MDN — constraint validation — https://developer.mozilla.org/en-US/docs/Web/HTML/Constraint_validation ; Attio API — create an attribute — https://docs.attio.com/rest-api/endpoint-reference/attributes/create-an-attribute

### Journey 4.2 — implementation note: field-editor libraries & shadcn fit (your ask)

You asked whether there are open-source components/libraries for these data types and their formatting, and whether **shadcn** works well with them. Short answer: **yes — most types map to a shadcn primitive, the two gaps have small MIT libraries, and the specialized formatting is handled by the same libraries we already picked elsewhere.** One important framing first:

**Two different rendering surfaces — shadcn applies to one of them.**
- **Inside the grid**, cells are drawn by **Glide Data Grid** on a *canvas* (doc 4c §A). React/shadcn components **cannot** render inside the canvas — Glide provides custom-cell renderers instead. So in-grid editors use Glide's cell kit **plus our formatting libraries** (below) so a phone/currency looks identical in the grid and on a form.
- **On forms, the record page, and the field-config panel** (all normal DOM), **shadcn/ui is a great fit** and is our default.

**Per type — component + library + shadcn fit:**

| Field type | Editor (DOM/forms) | Library | shadcn fit |
|---|---|---|---|
| Text / long text | `Input` / `Textarea` | — | native ✅ |
| Number | `Input` + numeric mask | **react-number-format** (MIT) | native ✅ |
| Currency | `Input` + `NumericFormat` (prefix, locale); store minor units | **react-number-format** + `Intl.NumberFormat`; **dinero.js**/**currency.js** for money math | native shell ✅ |
| Rating | star widget | **@smastrom/react-rating** (MIT) or lucide `Star` + `RadioGroup` | small lib (no native) ⚠️ |
| Checkbox / boolean | `Checkbox` / `Switch` | — | native ✅ |
| Date / timestamp | **Date Picker** = `Popover`+`Calendar` | **react-day-picker** (MIT) + **date-fns**; NL via **chrono-node** (4b.7) | native ✅ |
| Select / status | `Select` (chip rendered in trigger/option) | — | native ✅ |
| Multi-select | **Combobox** pattern (`Command`+`Popover`) multi | **cmdk** (already in stack) | shadcn recipe (no single native) ⚠️ |
| Record reference (single/multi) | **Combobox** with **async search** vs records API | **cmdk** — same primitive as @mention (4.15) + palette (4.12) | native pattern ✅ |
| Phone | `Input` shell, format as-you-type | **libphonenumber-js** (MIT) — already chosen (4b.13) | native shell ✅ |
| Email | `Input` + shape validation | **zod** `.email()`; deliverability deferred to enrichment (4b.13) | native ✅ |
| Website / URL | `Input` + normalize | **normalize-url** (MIT) — already chosen (4b.13) | native ✅ |
| Location | `Input`/Combobox (+ places API later) | — | native ✅ (v1 basic) |

**Cross-cutting:** one **zod** schema is generated per `AttributeDef` and drives **both** the form validation and the API validation (the same app-layer validator in *Field rules & history*), so a field is described once.

**Bottom line:** shadcn works well for **every DOM surface** (forms, record page, field config, pickers); the only two types without a single native shadcn component — **rating** and **multi-select** — are covered by a tiny MIT library or the standard shadcn Combobox recipe. shadcn does **not** apply inside the canvas grid, which uses Glide's renderers plus the same formatting libraries, so formatting stays consistent on both surfaces.

### Journey 4.2 — date entry is a real date picker, everywhere (your ask)

**Yes — every date/timestamp field uses a calendar date picker, Google-Sheets-style, on every surface.** This is a global rule, not per-field, so a rep never types a raw date string into a plain box and never sees a browser's native date control:

- **On forms, the record page, and config** (DOM): the shadcn **Date Picker** (`Popover` + `Calendar`, react-day-picker + date-fns). **Never `<input type="date">`** — this is the app-wide convention in [doc 12a §9](../development-guidelines/12a-engineering-conventions.md).
- **In the grid** (canvas): the same calendar opens as a **popover over the cell**, Sheets-style — click a date cell → a calendar drops down (Journey **4b.7.2**).
- **Type-ahead on top of the picker:** he can also just type **"tomorrow", "next tue", "friday 1pm"** and **chrono-node** parses it and moves the calendar to that date (Journey 4b.7 / 4d.14 due dates). The picker and the natural-language entry are the same control — type or click, his choice.
- **Consistent display:** dates render with the workspace/user format (e.g. "Aug 14, 2026", or relative "3 days ago"), per Journey 4b.13.6 and the timezone rules in [doc 12a §10](../development-guidelines/12a-engineering-conventions.md). Date-only values show no time; timestamps carry a zone label.

So the answer to "should we have a date picker throughout, like Google Sheets?" is **yes, and it's now stated as one rule** covering the field catalog (this journey), inline grid editing (4b.7.2), task due dates (4d.14), composite date chips (4f.4), and AI-column date outputs (4g.4).

- **Benchmark (beat this):** **Google Sheets — in-cell date picker** (click a date cell → calendar popover) — https://support.google.com/docs/answer/13951556 ; **Notion — `@`-date entry** for the type-ahead feel — https://www.notion.com/help/guides/using-slash-commands .

- **Build docs:** shadcn/ui components — https://ui.shadcn.com/docs/components ; shadcn Combobox (reference/multi-select) — https://ui.shadcn.com/docs/components/combobox ; shadcn Date Picker — https://ui.shadcn.com/docs/components/date-picker ; react-number-format — https://github.com/s-yadav/react-number-format ; @smastrom/react-rating — https://github.com/smastrom/react-rating ; libphonenumber-js — https://github.com/catamphetamine/libphonenumber-js ; normalize-url — https://github.com/sindresorhus/normalize-url ; zod — https://github.com/colinhacks/zod ; Glide custom cells — https://docs.grid.glideapps.com/api/dataeditor/custom-cells

## Journey 4.2a — Archive or delete a field (guarded), and why standard fields can't be deleted

*As an admin, I want to retire a field I no longer use without destroying its data by accident, and I must never be able to delete a field the app depends on.*

Fields, like objects (Journey 4.1a), retire safely. From a field's ⋯ menu:

1. **Archive a field (the safe default).** **Archive** hides the field from tables, forms, and the record page but **keeps every value and its history**. It's reversible (**Unarchive** brings it back). This is the recommended path and the first option offered — most "remove this field" needs are really "hide it."
2. **Delete a field (the destructive path, custom fields only).** Delete removes the field **and its values from every record.** So it's guarded like object delete:
   - a **confirmation modal states the blast radius** — "This field has values on **1,240 records**. Deleting removes the field and those values.";
   - it is a **soft delete into the 30-day trash** (job E6), not an instant wipe, so a mistake is recoverable;
   - the field's **history is retained** until the trash sweep, so a wrong delete can be reconstructed (Journey 4.I3).
3. **Standard / system fields cannot be deleted — the block (your ask).** A **system field** (e.g. Person → `companyId`, Deal → `stageId`, any seeded field the app reads by slug) has **no Delete control at all**; the menu shows it **disabled with a tooltip** ("System field — the app depends on it"). The most he can do is **rename it** or **hide it from views** (Journey 4.6a) — the underlying column stays so the dialer/reporting/relations keep working. This is enforced by `AttributeDef.isSystem`, not just hidden in the UI: the delete API rejects a system field.
4. **Roles.** Single-user today; **[LATER]** field archive/delete becomes admin-only when roles land (doc 11.4).

- **Benchmark (beat this):** Attio — archive vs delete an attribute — https://attio.com/help/reference/managing-your-data/attributes/create-manage-attributes ; Airtable — delete a field (with warning) — https://support.airtable.com/docs/deleting-a-field
- **Build docs:** internal — `AttributeDef.isArchived` + `deletedAt`; delete is blocked when `isSystem = true`; trash sweep = job E6.

## Journey 4.3 — Link objects with a reference field

*As an admin, I want to link one object to another with a reference field, so that a person connects to their company and reps can navigate between related records.*

1. The user adds a field of type **Record reference**.
2. He picks the target object (e.g. People → Companies).
3. Now a person record can point to a company, and the company shows its people (the reverse side is automatic — see job E4).
4. **Single vs multiple — the user chooses per field, we don't force one (your 4.3.4 ask).** When he creates a reference field he sets an **"Allow multiple values"** toggle:
   - **Off (single):** the field holds **one** related record — e.g. Person → **one** primary Company. The editor is a single record-picker.
   - **On (multiple):** the field holds **several** — e.g. Person → **many** phone numbers, or Deal → **many** People. The editor is a multi-picker with drag-order (step 5).
   - **Why a choice, not "always multi":** always-multi would let someone give a Person three primary companies, which breaks the "one employer" assumption the dialer and reporting rely on. Always-single would forbid three phone numbers. So it's per-field. Seeded fields ship with the right setting (Person→Company single; Person→phones multi).
   - **Changing it later — the journeys + edge cases:**
     - **Single → multiple (safe):** always allowed; existing single values become one-item lists. No data loss.
     - **Multiple → single (guarded):** if any record already holds **more than one** value, we **cannot silently drop the extras.** The app blocks the switch and shows a **resolution step**: "42 records have multiple values — keep the **primary/first** and archive the rest?" He confirms (extras are archived, not deleted, recoverable) or cancels. A record with 0–1 values converts with no prompt.
     - **This mirrors the option-retirement guardrail (4b.5.3):** a change that could destroy data always states the count and offers a safe resolution before proceeding.
5. **Sort order of the related records is captured by default — no toggle (your ask).** When a field can hold several related records, the app **stores their order** and the rep can **drag to reorder** them; the **first is treated as the "primary"** wherever a primary is meaningful (the primary phone the dialer calls, the primary contact on a deal). Details and reasoning:
   - **Why on by default, not a per-field toggle.** You asked whether users will ever need to keep the order of multiple related records — yes, often: which phone to call first, which email is preferred, who the primary contact is, the order people were added to a deal. Order is **cheap to keep** (it is just the array order in the JSONB value, plus a `position` when we need an explicit index), and losing it is annoying and irreversible. A toggle would force the user to predict, at field-creation time, whether order will ever matter — a bad ask that adds config for no real benefit. So we keep order everywhere and let the rep ignore it when it doesn't matter. This mirrors how a list keeps its own manual order (Journey 4.10).
   - **What "order" means per case.** Where a **primary** is meaningful (phones, emails, deal contacts) the first item is the primary and the rep can drag another to the top to promote it. Where order is just convenience, drag still works but nothing keys off position.
   - **Default when the app fills it in.** If enrichment or an import adds several related records, they land in the order received; the rep re-orders if he cares.

- **Benchmark (beat this):** Attio — relationship attributes — https://attio.com/help/reference/managing-your-data/attributes/relationship-attributes ; Attio — reordering values in a record — https://attio.com/help/reference/managing-your-data/records/configure-record-pages
- **Build docs:** Attio API — record-reference attribute type — https://docs.attio.com/rest-api/attribute-types/attribute-types-record-reference ; internal — ordered array in the JSONB value; explicit `position` where a primary must be hard (phones, doc 3.14c).

## Journey 4.4 — Set field rules

*As an admin, I want to set rules and a default on a field, so that the data stays clean and consistent as reps enter it.*

The user marks a field **required**, **unique**, or **read-only**, and sets a **default value**. Two UI patterns exist:

- **Airtable** puts limited validation inside the field-edit popover (it has no true "required"; it leans on field types and app logic).
- **Attio** exposes required/unique as toggles in the attribute's settings panel.

**We pick Attio's pattern: a simple settings panel on the field.** When he opens a field, a short section shows three toggles (Required, Unique, Read-only) and one **Default value** input. No separate rules-builder screen. The table and forms respect the rules — e.g. a save that breaks "required" is blocked inline, with the offending cell outlined red.

**The Default value input is type-aware — it must match the field's data type (your ask).** The default-value control is **not a free text box**; it renders the **same editor the field itself uses**, so a default can only ever be a valid value of that type:
- **date / timestamp** → a date picker (plus tokens like "today" / "now" for a relative default);
- **number / currency / rating** → a numeric input (currency shows the field's currency code);
- **select / status** → a dropdown of that field's existing options (Journey 4b.5); **multi-select** → a multi-pick of those options;
- **checkbox** → a true/false toggle;
- **phone / email / website** → the formatted input with the same validation as the field (Journey 4b.13);
- **record reference** → a record picker scoped to the target object.

The chosen default is **validated against the field's type and rules before it is saved** (a default cannot violate the field's own format), and it is applied on record create and when the field is added to existing records.

*The architecture, data model, and enforcement (why some rules are code-side, not DB-side) are in **Technical decisions → Field rules & history** at the bottom.*

- **Benchmark (beat this):** Attio — create & manage attributes — https://attio.com/help/reference/managing-your-data/attributes/create-manage-attributes ; Airtable — field types — https://support.airtable.com/docs/supported-field-types-in-airtable-overview
- **Build docs:** Attio API — create an attribute — https://docs.attio.com/rest-api/endpoint-reference/attributes/create-an-attribute

## Journey 4.5 — See a field's change history

*As a rep, I want to see who changed a field and what it was before, so that I can trust the data and trace a mistake back to its source.*

1. **Opening it — a popover, and where it's available (your ask: grid or record page? — both).** History is reachable **anywhere a field value is shown**:
   - **On the record page / drawer** (the primary place): the user **hovers a field** → a small **clock/"history" icon** appears at the field's right edge → **clicking it opens a popover** anchored to the field.
   - **In the grid** (doc 4c/4b): **right-click a cell → History** (or the same hover-clock on the active cell) opens the same popover over the cell.
   It is a popover — not a `<select>`-style dropdown menu and not a full page — because the content is a rich mini-list. It is scoped to **that one field's** history. *(Where each field journey happens: **4.2/4.3/4.4/4.6a** — creating/configuring fields — live in **Settings → Data model**; **4.5** — reading a field's history — and normal value editing happen **on the record page and in the grid**. Same field, different surfaces.)*
2. **What the popover shows — a vertical list of change rows, each showing old → new (your ask).** It is arranged **vertically, newest at the top**, one row per change. Each row reads:

   ```
   ● Ana Ruiz  ·  changed Stage        2:14 PM · Aug 14
     Demo  →  Closed — Won
   ● Ana Ruiz  ·  changed Amount        Aug 12
     $40,000  →  $52,000
   ● System (import)  ·  set Owner       Aug 09
     —  →  Ana Ruiz
   ```
   - Each row has the **actor** (avatar + name; "System" for imports/automations), the **relative time** (exact time on hover), and the change itself as **`old → new`** with an arrow.
   - The old value is **muted**, the new value is **normal weight**; for **select/status** fields both sides render as their **colored chips** (Journey 4b.5), so a stage change literally shows the two colored pills with an arrow between them. A first-time set shows `— → value`; a cleared field shows `value → —`.
   - The list **paginates** (cursor on `changedAt`, ~50 at a time) with "Load more" so a busy field never loads its whole history at once.
3. **E1 writes this log in the same transaction as the change** (synchronous, *not* a queued job — see *How writes are handled*), so a saved change can never exist without a record of who made it.

*How the log is stored so it stays small and fast is in **Technical decisions → Field rules & history** at the bottom.*

- **Benchmark (beat this):** Airtable — record revision history (the row-per-change `old → new` list is the concrete model) — https://support.airtable.com/docs/record-level-revision-history-overview ; Attio — activity/edit history on a record. *Also worth a look as inspiration for a dense, legible change list: Scratchpad.com's record-history UI — if its screenshots are reachable, match its clarity; if not, Airtable above is the binding benchmark.*
- **Build docs:** internal — reads the `FieldHistory` rows (data model below); popover via the shared floating-UI primitive.

## Journey 4.6 — Navigate the standard objects

*As a rep, I want the objects I use all day to be right in the navbar with their relations pre-wired, so that I can move from a person to their company, calls, and deals without setting anything up.*

The rep spends all day in **People, Companies, Deals, Calls, Emails, Texts, Meetings, Tasks** (the standard first-class objects — see *Terminology* at the top). Their schemas are fixed and defined here (full field lists + relations are in the data model at the bottom).

1. He clicks an object in the navbar → its table (Journey 4.7, doc 4c).
2. He clicks a row → the record detail page/drawer (Journey 4.11, doc 4d).
3. **The relations that ship (this is the spine of the app):**
   - **Person** → one **Company**; many **Calls, Emails, Texts, Meetings, Tasks, Notes**; optionally many **Deals**.
   - **Company** → many **People**; many **Deals**; and (rolled up) all **Calls / Emails / Texts / Meetings / Notes** across its people.
   - **Deal** → one **Company**; many **People**; a **pipeline stage**; many **Calls / Emails / Texts / Meetings / Tasks / Notes**.
   - **Call** → one **Person**, one **Company**, optionally one **Deal**, one **User** (who called); has one Recording, Transcript, Summary (**supporting** models, from doc 2).
   - **Email** → one **Person** (or several — a thread), optionally a **Deal**; a direction (in/out); body + subject (compose/sync is doc 5).
   - **Text (SMS)** → one **Person**, optionally a **Deal**; a direction; message body (send/sync is doc 5, 10DLC in doc 3).
   - **Meeting (calendar event)** → many **People**, optionally a **Deal**; a time slot; may be linked from a **Task** (Journey 4.14 step 5). Sync is doc 5.
   - **Task** → an assignee + a due date + links to any of Person / Company / Deal / Call (Journey 4.14). *(This is the object formerly called "Actions".)*
4. **Calls, Emails, and Texts are high-volume, so they keep real tables** (not the generic `Record` store) and are **surfaced as first-class objects via an adapter** — so they get a navbar link, a table, and timeline entries like any object, without paying the JSONB cost for millions of rows (see *Technical decisions → Standard vs custom objects*).

*How all these relations are surfaced so the rep finds them in 1–2 clicks — including "show me other people's calls at the same company" — is the whole of **[4a-crm-relations-and-related-records.md](4a-crm-relations-and-related-records.md)**.*

- **Benchmark (beat this):** Attio — objects & records — https://attio.com/help/reference/attio-101/attios-data-model/understanding-objects-and-records
- **Build docs:** internal — schemas in the data model below.

## Journey 4.6a — View a standard object, and extend it with custom fields

*As an admin, I want to see how a standard object like People is set up and add my own fields to it, so that the CRM fits my business without letting me break the fields the app depends on.*

You asked whether default (standard) objects can be viewed and edited, and what CRUD applies to them. Here is the full rule.

1. **View the schema.** In Settings → Data model the user opens a standard object (e.g. People) and sees its fields, types, and relations — the same editor as a custom object, but with the standard fields marked **"System"**.
2. **What he *can* change on a standard object:**
   - **Add custom fields** to it (People/Companies/Deals/etc. all accept custom fields — same as Journey 4.2). These behave exactly like custom-object fields.
   - **Rename, re-icon, hide, and reorder** fields, including system fields (a system field can be renamed and hidden from views, because that is cosmetic).
   - **Archive a custom field** he added.
   - CRUD the **records** normally (create/read/update/archive/delete rows) — records of a standard object work identically to a custom object's records.
3. **What he *cannot* do (guardrails):**
   - **Delete or re-type a system field.** A system field (e.g. Person → `companyId`, Deal → `stageId`) cannot be deleted or have its type changed, because the dialer, reporting, and relations read it by slug. The editor shows these controls **disabled with a tooltip** ("System field — the app depends on it").
   - **Delete or archive the object itself** (Journey 4.1a step 6).
4. **Why hide-not-delete.** Hiding a system field removes it from the rep's view without breaking the code that reads it. This gives the "clean it up" benefit with none of the "broke the app" risk.

- **Benchmark (beat this):** Attio — standard vs custom attributes (system fields you can extend, not remove) ; HubSpot — default vs custom properties — https://knowledge.hubspot.com/properties/manage-your-properties
- **Build docs:** internal — `AttributeDef.isStandard`/`isSystem` gates the delete/retype controls; add-field reuses Journey 4.2.

---

## How writes are handled — synchronous vs. background (this doc)

Not everything is a background job. Some writes must happen **inside the same database transaction as the change** (so they can never be lost or drift out of sync); others can safely run **later, on the pg-boss queue**. Here is the split, and the reasoning for the two you asked about (E1, E4).

**Synchronous — runs in the same transaction as the record write:**
- **E1 — Field history.** When a field changes, we write the `{who, old, new, when}` row **in the same transaction** as the record update. **Why not a queued background job (your question):** a change and its history must **both commit or both roll back**. If history were a separate queued job, a crash between the two could leave a saved change with *no record of who made it*, or (worse) a history row for a change that was rolled back. The write is tiny — tens of bytes — so doing it inline costs nothing and buys correctness. *(This corrects the earlier "background job" label on E1; it is a synchronous write.)*

**Background jobs — pg-boss queue; a short delay is acceptable:**
- **E2 — Search index** (doc 4e). *Trigger:* after a record write. *Steps:* recompute that row's `tsvector`. *pg-boss:* `singletonKey = recordId` (collapse rapid edits), retry ×3 with backoff. Near-real-time is fine for search.
- **E3 — Notification fan-out + batch** (doc 4e). *Deliberately* delayed — it batches noisy events on a sliding window.
- **E5 — Activity fan-out** (doc 4d / 4a). *Trigger:* on write of any timeline-eligible record. *Steps:* write the denormalized `CompanyActivity` row. The UI writes optimistically, so the just-logged item shows immediately and a sub-second feed lag is invisible. *pg-boss:* retry ×5, `singletonKey = sourceId`.
- **E6 — Trash sweep.** *Trigger:* a scheduled job (pg-boss cron, hourly). *Steps:* hard-delete records/objects past their 30-day `deletedAt`, honoring the relation rules (§ Delete & archive).

**E4 — the reverse side of a relation (clarified — your ask).** You asked what "relation sync" means; here it is in plain terms. **The reverse side of a normal reference is a *query*, not a stored copy.** If Dana points to Acme (`companyId`), then "Acme's people" is just an **indexed lookup** (`WHERE companyId = Acme`) — always correct, no job needed. Many-to-many relations (Deal↔People) use join tables, which are queryable both ways with no sync. So **ordinary relations need no background job at all** — the earlier "write both directions and reconcile" was over-engineered. The *only* real work is **re-homing denormalized activity when a person changes company:** if Dana moves from Acme to Beta, her past `CompanyActivity` rows (doc 4a) must re-point to Beta so each company's account feed stays correct. **That re-homing is what E4 now is** — a small background job triggered by a company-reference change (*pg-boss:* retry ×3, `singletonKey = personId`) — nothing more.

---

## Decisions (objects, fields & schema)

**Delete vs archive — Decided (you agreed): archive by default; hard-delete goes to a 30-day trash.** (Complexity unpacked in Technical decisions → Delete & archive. Object-level delete is Journey 4.1a.)

*(Other family decisions live with their doc: table feel + pagination in doc 4c; record-page layout in doc 4d; command palette + search engine in doc 4e.)*

---

## Technology choices (where it is not obvious)

*(This section is **library/stack picks only.** The storage-model reasoning lives in one place — **Why two storage models**, below — so it isn't stated twice.)*

- **Storing dynamic objects — generic `Record` + a JSON values column** (not EAV, not table-per-object). Full reasoning + quantified tradeoffs in **Why two storage models** below. (On the earlier "Attio/Airtable use JSONB" claim — I withdrew it; I have no source for their internal storage. Our choice stands on its own merits.)
- **Field-editor components — shadcn/ui + a few MIT libs.** See *Journey 4.2 — implementation note* above.

*(Grid library (Glide) → doc 4c §A; notes editor (TipTap) → doc 4d; filters/palette/drag libraries → the docs that use them; search engine (Postgres FTS) → doc 4e.)*

## Why two storage models — and why the real tables aren't in this file (your "did you screw up?" question)

Short answer: **it's intentional.** There are two kinds of data and we deliberately store them two different ways. **We give them names (terms of art) and use them everywhere:**

- **Dynamic objects (Kind 1)** — objects the user can reshape at will (People, Companies, Deals, Tasks, and every custom object). Stored as **generic `Record` rows whose values live in one JSON column**, described by `ObjectDef`/`AttributeDef` rows.
- **Table-backed objects (Kind 2)** — high-volume data the app itself generates and the user does *not* reshape (Calls, Emails, Texts, Meetings, and their parts like recordings/transcripts). Stored in **real, purpose-built Postgres tables**, surfaced as first-class objects via an adapter.

**Why dynamic objects use `Record` + JSON (three options weighed):**
1. **A real table per object, with real columns.** Cleanest to query — but **every "add field" click would run a live schema change (`ALTER TABLE`) on the production database.** Slow and risky at runtime. *Rejected.*
2. **EAV — "entity-attribute-value," one row per single field value.** Endlessly flexible — but **reading one record means stitching dozens of rows with joins,** and filtering/sorting gets slow. *Rejected.*
3. **Generic `Record` + a JSON values column (our pick).** The *schema itself is data* (`AttributeDef` rows), so **adding a field is just inserting a row — no migration.** Values sit in one JSON column Postgres can index (GIN). We give up DB-enforced types/uniqueness, enforced instead in app code (§ Field rules & history). *Chosen — the only option where "users reshape objects safely at runtime" is cheap.*

**Why table-backed objects use real tables — quantified (your ask to put numbers on it).** For Calls/Emails/Texts there can be **10M+ rows**, the shape is fixed, and doc-5/doc-9 **reporting scans them heavily**. Storing them as dynamic `Record`s would cost real money and latency. Rough, order-of-magnitude estimates (retune with real benchmarks):

| Cost dimension | Dynamic `Record` + JSON | Real typed table | Why it matters at 10M rows |
|---|---|---|---|
| **Storage per row** | JSON **repeats the key names on every row** (~120–180 bytes of key strings for a ~15-field Call) + JSONB structure overhead | just the typed values | ~**1.3–2×** more disk (~1.5–3 GB of *just repeated key strings* at 10M rows) |
| **Filter/sort a field** | `valuesJson->>'x'` extraction, needs a GIN or per-field expression index; planner is weaker on JSON | native B-tree on a real column | ~**2–5× slower** per query at scale |
| **Analytics scan** (reporting) | JSON extraction per row across millions | columnar-friendly typed scan | the difference between a **snappy** and a **multi-second** report |
| **Write** | fine | fine | not the bottleneck either way |

So the trade is: **dynamic objects** (People/Companies — thousands to low-millions of rows, must be reshapeable) are worth the modest overhead for flexibility; **table-backed objects** (10M+, fixed schema, heavy reporting) save ~1.3–2× storage and multiples of query time — flexibility they don't need. Both still **appear identical in the CRM** (navbar + table + timeline) via the adapter, so a rep can't tell which storage a given object uses.

*(When the GIN and expression indexes are built, and how we guard against type/schema corruption and index failure, is its own section: **Data integrity, indexing & recovery**, below.)*

**Why those real tables aren't in this file's Prisma block (the part that looked like a mistake):** they are **defined in the docs that own them**, not duplicated here — **`Call` → doc 2, `SmsMessage`/`PhoneNumber` → doc 3, `Email`/`Meeting` → doc 5.** Repeating them here would create two copies that drift apart. So this doc's Prisma block holds **only the models it introduces** (`ObjectDef`, `AttributeDef`, `Record`, `PipelineStage`, `FieldHistory`). The omission is on purpose; the pointer is: *Calls → doc 2, Texts → doc 3, Emails/Meetings → doc 5.*

## Data model (Prisma) — additions in this doc

**New models marked `// NEW`.** *(View/list models are in doc 4c; note/task in doc 4d; notification in doc 4e; the real Call/Email/Text/Meeting tables in docs 2/3/5 — per the section above.)*

```prisma
model ObjectDef {          // NEW — a standard or custom object (People, Deals, Partners…)
  id          String   @id @default(cuid())
  workspaceId String
  slug        String            // "people", "deals"
  name        String
  icon        String?
  isStandard  Boolean  @default(false) // seeded standard objects (Axis 1)
  isFirstClass Boolean @default(true)  // gets a navbar link + table (Axis 2); false = supporting model
  isArchived  Boolean  @default(false)
  isHidden    Boolean  @default(false) // navbar link hidden (standard objects can only be hidden, never deleted — Journey 4.1a)
  deletedAt   DateTime?                // custom-object soft delete → 30-day trash (Journey 4.1a; blocked for standard)
  attributes  AttributeDef[]
  @@unique([workspaceId, slug])
}

model AttributeDef {       // NEW — a field on an object (Journeys 4.2/4.3/4.4)
  id          String   @id @default(cuid())
  objectId    String
  slug        String
  name        String
  type        String            // text|number|checkbox|date|timestamp|phone|email|website|select|multiselect|currency|rating|status|location|reference
  optionsJson Json?             // colored options for select; currency code; etc.
  refObjectId String?           // for type=reference (Journey 4.3)
  isRequired  Boolean  @default(false)
  isUnique    Boolean  @default(false)
  isReadOnly  Boolean  @default(false)
  isSystem    Boolean  @default(false) // seeded field the app depends on: rename/hide OK, delete/retype blocked (Journeys 4.2a/4.6a)
  isMulti     Boolean  @default(false) // reference/select: single vs multiple values (Journey 4.3.4)
  defaultJson Json?             // type-aware default; validated against type + rules (Journey 4.4)
  isArchived  Boolean  @default(false) // hidden, values kept (Journey 4.2a)
  deletedAt   DateTime?         // custom-field soft delete → 30-day trash (Journey 4.2a; blocked when isSystem)
}

model Record {             // NEW — one row of any generic object; values in JSONB
  id          String   @id @default(cuid())
  workspaceId String
  objectId    String
  valuesJson  Json              // { attributeSlug: value, ... } — GIN-indexed; empty = key absent, never "" (§ Empty values)
  isArchived  Boolean  @default(false) // archive-by-default
  deletedAt   DateTime?         // 30-day trash before hard delete (job E6)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Standard-object field shapes (seeded as AttributeDefs; shown here for clarity) --------
// Person:  legalName, preferredName (nickname/diminutive), title, companyId(ref Company),
//          ownerId(ref User), timezone, lastContactedAt, persona,
//          attentionStatus (on_deck|on_hold|backburner|disqualified — Journey 4.18),
//          attentionReason (select+free-text; e.g. other_stakeholder|cooled|timing — Journey 4.18),
//          callbackDate (drives the Backburner auto-return workflow — Journey 4.18.3)
//   • DISPLAY NAME = preferredName if set, else legalName. This is the name shown almost
//     everywhere (and what the dialer says / the rep reads). (Ideas #4, #8, #20)
//   • persona = enum: decision_maker | gatekeeper | champion | influencer | user | other
//     (Idea #6). Set by the rep or by the AI on a call (Idea #10).
//   • emails[] -> EmailAddress objects; phones[] -> ContactPhone objects (doc 3.14c),
//     each carrying its own status (valid/dead) + provenance — the universal "dead value"
//     pattern (Ideas #1/#2/#17/#19). "Dead" applies to titles/emails/numbers alike.
// Company: dba (the name they go by), legalName, domain, alternateDomains[], industry,
//          size, ownerId(ref User), attentionStatus + attentionReason + callbackDate (Journey 4.18)
//   • DISPLAY NAME = dba if set, else legalName (Idea #5). LinkedIn/enrichment fills dba
//     from the name they actually use (Idea #9).
// Deal:    name, companyId(ref Company), contacts via DealContactRole (person+role per deal),
//          stageId(ref PipelineStage), amount(currency), closeDate, ownerId(ref User)
// Task:    see the Task model in doc 4d (this is the object formerly called "Actions")

model PipelineStage {      // NEW — Deals pipeline config (seeded; used by the Deals kanban, doc 4c 4.9)
  id          String @id @default(cuid())
  workspaceId String
  name        String
  color       String
  sortOrder   Int
  winProbability Int @default(0)  // stage weight 0..100 for the stage-weighted forecast (doc 9 Journey 9.6); seeded, editable in Settings → Pipeline
}

model FieldHistory {       // NEW — Journey 4.5 / job E1 (compact old/new JSON, paginated)
  id          String   @id @default(cuid())
  recordId    String
  attribute   String
  oldJson     Json?
  newJson     Json?
  changedBy   String
  changedAt   DateTime @default(now())
  @@index([recordId, changedAt])
}
```

### Seeded standard-object shapes (what ships in each — your ask)

These are the fields the seed script creates on a new workspace. For the JSON-stored objects (People/Companies/Deals/Tasks) these are seeded `AttributeDef` rows; for the real-table objects (Calls/Emails/Texts/Meetings) this is the shape of the table defined in the linked doc — listed here so the whole seeded model is in one place.

- **Person** — `legalName`, `preferredName` (nickname), `title`, `companyId` (→ Company), `ownerId` (→ User), `timezone`, `lastContactedAt`, `persona` (decision_maker | gatekeeper | champion | influencer | user | other), `attentionStatus` (on_deck | on_hold | backburner | disqualified — 4.18), `attentionReason`, `callbackDate`, `emails[]` (→ EmailAddress, each with valid/dead status + provenance), `phones[]` (→ ContactPhone, doc 3.14c). **Display name** = `preferredName` if set, else `legalName`.
- **Company** — `dba` (name they go by), `legalName`, `domain`, `alternateDomains[]`, `industry`, `size`, `source` (where it came from, doc 5a), `ownerId` (→ User), `attentionStatus` + `attentionReason` + `callbackDate`. **`parentCompanyId` (self-reference → Company)** links a subsidiary/branch to its parent; you can **group and roll up by parent** (Journey 4a.10, and group-by in doc 4c Journey 4.8.4). **Display name** = `dba` if set, else `legalName`.
- **Deal** — `name`, `companyId` (→ Company), **contacts via `DealContactRole`** (person + role per deal — see *Schema verification*), `stageId` (→ PipelineStage), `amount` (currency), `closeDate`, `ownerId` (→ User).
- **Task** — `title`, `type` (call | email | todo), `priority` (low | med | high), `commitment` (hard/appointment | soft/reminder), `assigneeId`, `dueAt`, `remindAt`, `eventId` (→ Meeting), `isDone`/`doneAt`, `links[]` (→ any record). Full model in doc 4d.
- **Call** *(real table, doc 2)* — `personId`, `companyId`, `dealId?`, `userId` (who called), `direction`, `disposition`, `startedAt`, `durationSec`, plus one `Recording` + `Transcript` + `Summary` (supporting models).
- **Email** *(real table, doc 5)* — `personId(s)` (thread), `dealId?`, `direction`, `subject`, `body`, `sentAt`, `threadId`.
- **Text / SMS** *(real table, doc 3)* — `personId`, `dealId?`, `direction`, `body`, `sentAt`, `phoneNumberId`.
- **Meeting** *(real table, doc 5)* — `peopleIds[]`, `dealId?`, `title`, `startsAt`/`endsAt`, `location`, `externalEventId` (calendar sync).
- **PipelineStage** *(supporting)* — `name`, `color`, `sortOrder`, `winProbability` (0..100 stage weight for the doc 9 forecast) (seeded default pipeline; user-editable, never overwritten — § Seeding).

## Technical decisions, trade-offs & edge cases

**Standard vs custom objects — when is something built-in?** (Full terminology is in *Terminology: two axes* at the top; the *storage* model — dynamic vs table-backed — is in *Why two storage models*. This note is only the standard/custom axis.) A **standard object** is one the app ships, seeds, and depends on (People, Companies, Deals, Calls, Emails, Texts, Meetings, Tasks). A **custom object** is one the user invents at runtime (e.g. "Partners"), which only they read/write. The rule: *if the app's own code or another feature must rely on a field existing, it's standard; if only the user cares, it's custom.* Deals is **standard** (the dialer/reporting/pipeline depend on it); "Partners" was only ever an **example of a custom** object. Note the two axes are independent: most standard objects are **dynamic** (seeded `Record`s), but Calls/Emails/Texts are standard **and** table-backed (see *Why two storage models*).

**Field rules & history (Journeys 4.4 / 4.5).** Because values live in JSONB, the DB can't enforce required/unique/type — the **app layer validates on write against `AttributeDef`**, plus a **partial unique index** on the extracted value where uniqueness must be hard. History (E1): *"can get large"* was vague — concretely, a workspace doing ~5k field edits/day writes ~1.8M rows/year. The fix: store only a **compact `{old, new}` JSON per change** (not a full record snapshot) — so each row is small (tens of bytes, not KBs) — and **paginate** the History view (cursor on `changedAt`, e.g. 50 at a time) so we never load a field's whole history at once. Net: the table stays cheap to write and the UI stays fast.

**Empty values — one canonical "empty" is `null`/absent, never `""` (your ask).** You flagged the real bug: if a user clears a field, a naive save stores an **empty string `""`**, which is a *different value* from "never set", so `"is empty"` filters, uniqueness, and dedupe all misbehave. Our rule: **on every write we normalize "empty" to absence** — we **omit the key from the JSONB** (equivalently `null`), never store `""`, `[]`, or whitespace. Per type:
- **Text / phone / email / website / location** → a cleared or whitespace-only value becomes **absent**. (We trim first, so `"  "` is empty.)
- **Number / currency / rating** → cleared becomes **absent**, never `0` (0 is a real value and must stay distinct from empty).
- **Date / timestamp** → cleared becomes **absent**.
- **Select / reference** → cleared becomes **absent**; **multi-select / multi-reference** → an empty array becomes **absent**, never `[]`.
- **Checkbox** → this is the one deliberate exception. A checkbox is **two-state by default** (`false` is a real answer, not empty), so cleared = `false`. **Only** when the field is explicitly configured as a **tri-state** ("Unknown" matters — e.g. "Opted in?") do we allow `null` = unknown, distinct from `false`.

So there is exactly one representation of "empty" (the key is gone), which makes `"is empty" / "is not empty"` filters, required-checks, and uniqueness all correct and consistent. This matches **Attio** and **HubSpot**, which both treat a cleared property as *unset* (their "is unknown/is empty" filters key off absence, not `""`). Enforced in the same app-layer write validator that checks required/unique/type (see *Field rules & history*).

**Delete & archive — the complexity behind "hard-delete after 30 days":**
- **Cross-workspace data?** No — every model carries `workspaceId` and nothing is shared across workspaces, so a delete never has to reason across tenants. (If that ever changes, this section must be revisited first.)
- **Permission models?** Not yet — single-user, so "who can delete/restore" is trivial today. When roles land ([LATER]), restore/hard-delete become admin-only; noted so we don't bake in an assumption.
- **Relations on delete — the real work.** Deleting a record that others reference (e.g. a Company referenced by 200 People, Deals, Calls) needs a rule. We use: **archive is always safe** (just hidden; references intact). **Hard-delete (after 30 days, or forced) is blocked if required references point at it** — the user must reassign or delete those first — and for optional references we **null the reference** and log it. The trash sweep (E6) checks this per record and skips (and flags) any that would orphan required data. This matters most for hard delete precisely because archive kept everything intact.

**Two-sided relations.** Setting Person→Company must surface Company→People. **The reverse side is a query, not a stored copy** — `WHERE companyId = X` on an indexed column — so there is nothing to "sync" for ordinary relations (this corrects an earlier note; see *How writes are handled → E4*). Many-to-many relations use join tables, queryable both ways.

---

## Seeding: how a workspace gets its standard objects (journeys)

Standard objects, their fields, and the default pipeline are **data, not code**, so a new workspace must be **seeded**. You asked whether we have journeys for seed / update-seed / un-seed — here they are.

### Journey 4.S1 — Seed a new workspace (the algorithm)

*As the system, I want to install the standard objects and defaults when a workspace is created, so that a new user starts with a working CRM.*

1. **Trigger:** a workspace is created (Journey 1.1). This enqueues a **`seed-workspace`** job.
2. **Steps (idempotent):** for each standard `ObjectDef`, default `AttributeDef`, and default `PipelineStage`, **insert-if-absent** keyed on `(workspaceId, slug)`. Re-running never duplicates (the `@@unique` constraints guarantee it).
3. Also seeds the sibling defaults that follow the same rule: dispositions (doc 2), SMS templates (doc 3), notification categories (doc 4e), AI summary templates (doc 2.7), default conditional-format rules (doc 4b.4).
4. **pg-boss:** `seed-workspace` queue, `retryLimit: 5`, idempotent — a retry after a partial failure completes the rest and skips what exists.

### Journey 4.S2 — Update the seed on a new release (backfill, without clobbering edits)

*As the system, I want a new default field/stage shipped in a release to reach existing workspaces, without overwriting anything a user already changed.*

1. **Trigger:** a deploy that adds a new default (e.g. a new field on the standard People object) runs a **backfill migration**.
2. **Steps:** for every existing workspace, **insert the new `AttributeDef`/`PipelineStage` only if that slug is absent.** Never update or overwrite an existing row — a user's renamed/recolored/reordered stage is *their* data and is left untouched.
3. This is why the seed is **insert-if-absent, never upsert-overwrite**: the invariant is "**seed idempotently, never overwrite user edits, backfill new defaults on release**."

### Journey 4.S3 — "Un-seed" / retire a default (guarded)

*As the system, I want to retire a default we no longer ship, without destroying data a user relies on.*

1. We **do not hard-delete** a standard object or a seeded field to "un-seed" it — that would break existing workspaces (guardrails, Journeys 4.1a / 4.6a).
2. Retiring a default is a **guarded migration that archives** (never deletes) the field/stage (`isArchived = true`), so existing records keep their values and history. New workspaces simply stop seeding it.
3. So "un-seed" = archive-on-migration, the same safe path as any field retirement (Journey 4.2a).

### Journey 4.S4 — Generate a Prisma-style schema markdown for EVERY object (internal engineering tool)

*As an engineer, I want a command that writes ONE markdown file showing every object in the product as a Prisma-style model — the dynamic ones (People, Companies, Deals, Tasks, custom) rendered as if they were tables, and the real tables as they are — so that there is a single place to read the whole schema.*

Why this is needed: the dynamic objects (Kind 1) **have no real Prisma model** — their fields live as `AttributeDef` rows and their values in the `Record.valuesJson` column (*Why two storage models*). So `schema.prisma` shows `Record`/`AttributeDef`, **not** a `Person` model with typed columns. An engineer reading the schema can't see "what fields does a Person actually have?" without querying the seed. This tool closes that gap by rendering the live `AttributeDef` rows *as if* each object were a Prisma model — a documentation artifact, not a migration.

1. **Trigger — on demand, and in CI.** An engineer runs a script (e.g. `npm run schema:dump`) locally, and the same script runs in **CI on every merge to `main`** so the generated file is always current. It is **read-only** — it introspects definitions and writes a markdown file; it never touches data or `schema.prisma`.
2. **Which objects it covers — ALL of them, in one file (Ryan, 2026-08-20).** Every **dynamic** object (**People, Companies, Deals, Tasks**, plus every **custom** one) AND every **table-backed** model (`Call`, `User`, `Workspace`, `Record`…), in a single document, each labelled with its storage kind so nobody mistakes one for the other.

   This reverses an earlier decision here, which was to exclude the real tables and link out to docs 2/3/5. Ryan's reason for the reversal: *"we don't have a clear place where I can read the schema"* — and a file that covers half the model and links away for the rest is not that place. Splitting the map was the whole problem, so the fix cannot preserve the split. The real tables are rendered from the live Prisma DMMF (`Prisma.dmmf.datamodel`), which needs no database, so including them costs one more source and no extra machinery.
3. **Steps (the algorithm).** For each dynamic `ObjectDef`: read its `AttributeDef` rows and emit a fenced ```prisma block that renders the object as a pseudo-model — one line per field with its `type` mapped to the nearest Prisma type (text→`String`, number→`Int`/`Float`, currency→`Decimal`, checkbox→`Boolean`, date/timestamp→`DateTime`, select/status→a `// enum: a|b|c` comment, reference→`String // → TargetObject`, multi→`[]`), plus `?` for optional and inline comments for `isSystem` / `isRequired` / `isUnique` / default. It also notes each object's storage kind (dynamic `Record` + JSON) at the top so no reader mistakes it for a real table.
4. **Output.** One markdown file, `docs/generated/schema.md` (renamed from `dynamic-object-schemas.md` when this stopped being dynamic-only) with a header stating it is **auto-generated — do not edit by hand**, a timestamp, and the source (the seed for standard objects; the live workspace or a named workspace id for custom objects — a flag chooses which). It renders each object as a section with its Prisma block, dynamic objects first and real tables after, each linking to the journey doc that owns it.
5. **Which schema source.** By default it dumps the **seeded standard shapes** (deterministic, from the seed definitions in *Seeded standard-object shapes*), so the file is reproducible in CI without a database. A `--workspace <id>` flag instead introspects a real workspace to include that workspace's custom objects and any admin-added fields — for debugging a specific tenant.
6. **pg-boss:** none — this is a **build/CLI script**, not a queued job (it runs in dev or CI, not in the app runtime).

- **Benchmark (beat this):** Prisma schema readability (the target output style) — https://www.prisma.io/docs/orm/prisma-schema ; Prisma DMMF / `getDMMF` (introspecting definitions programmatically) — https://www.prisma.io/docs/orm/reference/prisma-client-reference ; the idea mirrors Prisma's own `prisma db pull` (introspect → schema), but our "tables" are `AttributeDef` rows, not Postgres tables.
- **Build docs:** internal — a Node script that reads `ObjectDef`/`AttributeDef` (from the seed module or a workspace), maps `AttributeDef.type` → Prisma type, and writes markdown; wired into CI (doc 12 GitHub Actions) so `docs/generated/schema.md` is regenerated and verified on merge (`--check` fails when the committed file is stale, the same contract as `rls:check`).

---

## Data integrity, indexing & recovery (because the DB doesn't enforce our schema)

You flagged the real risk: because dynamic objects store values in JSON, **Postgres does not enforce our types or uniqueness** — so we must guard against corruption and index failure ourselves, and be able to recover. This is that plan. (Table-backed objects, Kind 2, keep normal DB constraints and need none of this.)

### When indexing happens — automatic vs. a job (your ask)

- **The GIN index on `valuesJson` is automatic and in-transaction.** Postgres maintains it on every row write, in the same transaction — **it is not a background job**, and it can never lag behind a write.
- **A per-field unique / expression index is built by a job when a field is turned unique or heavily filtered** — see Journey 4.I1. This *is* a job, because building an index on a large table must run `CONCURRENTLY` to avoid locking.
- **The full-text search index (`tsvector`) is job E2** (doc 4e) — near-real-time, async.

### Journey 4.I1 — Build a field index when uniqueness/indexing is turned on

*As the system, I want to add a real index when an admin marks a field unique, so that the constraint is enforced fast and safely.*

1. **Trigger:** an admin toggles a field **Unique** (Journey 4.4) or marks it indexed. Enqueue **`build-field-index`**.
2. **Steps:** run `CREATE UNIQUE INDEX CONCURRENTLY` on the extracted JSON expression (partial, scoped to `workspaceId + objectId`). **While the index is still building, the app-layer validator enforces uniqueness in application code** (a `SELECT` check), so there is never a window with no enforcement.
3. **On success:** enforcement moves to the DB index (fast). **On failure** (e.g. existing duplicates block a unique index): the field's uniqueness stays **"pending"**, the admin is shown **which rows collide**, and enforcement stays in-app until he resolves them. Nothing silently half-applies.
4. **pg-boss:** `build-field-index` queue, `retryLimit: 3`, alert on repeated failure.

### Journey 4.I2 — Integrity sweep (catch type/schema drift before it bites)

*As the system, I want to periodically check that stored values still match their field definitions, so that bad data is caught and quarantined instead of corrupting reports.*

1. **Primary guard first:** **every write goes through one validator** against `AttributeDef` (type, required, unique, empty-normalization). There is **no raw-JSON write path** — this is the main defense, so corruption should be rare.
2. **The sweep (defense in depth). Trigger:** scheduled nightly (pg-boss cron). **Steps:** scan records (all, or a rolling sample for big workspaces) and check each value against its field's current type/options. A mismatch (e.g. a field re-typed from text→number leaving old text values, or a value written by an old bug) is **flagged and quarantined** into a repair queue, not deleted.
3. **Alerting:** if the mismatch rate exceeds a threshold, alert (doc 12 observability) — a spike means a real bug in a write path.
4. **pg-boss:** `integrity-sweep` queue, low priority, batched.

### Journey 4.I3 — Recover from corruption or a bad migration

*As an admin (or us), I want to recover records that got corrupted, so that a bug or a bad bulk edit is never permanent.*

1. **Field-history replay (E1).** Because every field change stores `{old, new}` (Journey 4.5), we can **reconstruct a field's prior value** and roll a record back to any point — the history log doubles as an undo trail.
2. **Point-in-time restore.** Postgres PITR / daily backups (doc 12) recover a whole workspace to a timestamp before the damage.
3. **Quarantine + repair.** Rows flagged by the integrity sweep (4.I2) sit in a repair view where an admin can bulk-fix or restore them; they're never auto-deleted.
4. **Index rebuild.** If an index is found missing/corrupt, re-running **`build-field-index`** (4.I1) rebuilds it concurrently while in-app enforcement covers the gap.

---

## Schema verification vs Salesforce & Attio (is our model at least as good?)

You asked me to check our object model against Salesforce and Attio and find anything missing. I researched both ([Salesforce object reference](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm) · [Attio standard objects](https://attio.com/help/reference/managing-your-data/objects/manage-standard-objects) · [Attio data model](https://attio.com/help/reference/attio-101/attios-data-model/understanding-attio-data-model)). **Verdict: structurally we're at least as good — richer than Attio on the activity/telephony side, and we correctly skip Salesforce's dead weight — with two real gaps, one of which we fix here.**

**What we correctly do NOT copy** (validated by Attio + HubSpot both moving this way):
- **No standalone `Lead` object.** A Person + `attentionStatus` is the modern model (Attio has no Lead; leads are People in a List). *(One nuance below.)*
- **No Pricebook / CPQ / Quote line-items** — enterprise weight a dialer-first app doesn't need. A single `amount` on Deal covers most cases.
- **No marketing `Campaign` object** — a `source` field on Person/Company (already added, doc 5a) suffices near-term.

**Gaps and decisions:**

| Gap (SF/Attio has it) | Do we need it? | Decision |
|---|---|---|
| **Deal↔Contact role** (SF `OpportunityContactRole`) — a contact's role *on a specific deal* (champion / decision-maker / economic-buyer / blocker), many contacts per deal | **Yes, now** — this is core sales multi-threading (MEDDIC), and **docs 6.11 and 9 already assume it exists** | **Added here: `DealContactRole` join model** (below). Fixes the biggest hole. |
| **Sequences / cadences** (SF Sales Engagement / Salesloft-Outreach) — ordered multi-step outreach playbooks | **Yes** — table-stakes for a dialer-first app | **Already owned by doc 10 (workflows) + doc 3 (call lists) + doc 7b (automation).** Cross-referenced, not rebuilt here. |
| **Repeatable prospecting attempt per Person** (HubSpot's newer lightweight Leads object — multiple sales cycles on one person) | **Maybe, later** — a single `attentionStatus` enum can't hold two concurrent/historical cycles on one person | **[LATER]** — model as a "prospecting attempt" / sequence enrollment (doc 10) rather than a Lead object; noted so the enum isn't over-loaded. |
| **Company parent hierarchy** (SF `Account.ParentId`) — subsidiaries / franchises | **Yes, now (your ask)** — reps sell into franchises/subsidiaries and want to see and roll up the whole family | **Build now: a nullable `parentCompanyId` self-reference on Company** (a normal record-reference field, Journey 4.3, pointing back at Company). Linking + reverse "subsidiaries" side + group/roll-up by parent = **Journey 4a.10**; group-by-parent in views = doc 4c Journey 4.8.4. Cheap, non-breaking. |
| **Deal line items** (SF `OpportunityLineItem`) — value breakdown per product | **Maybe, later** | **[LATER]** — a lightweight optional `DealLineItem` (label, qty, amount), **not** full CPQ, only if deals need a value breakdown. |
| **Contact ↔ multiple companies** (SF `AccountContactRelation`) | **Later** | **[LATER]** — promote Person→Company to a join if board-members/job-changes need it; most dialer flows assume one current employer. |

*(Benchmarks: [OpportunityContactRole](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm) for the role join; [HubSpot Leads object](https://huble.com/blog/inbound23-hubspot-lead-object) for the repeatable-attempt nuance.)*

**Schema addition — `DealContactRole` (the one we build now):**

```prisma
model DealContactRole {     // NEW — a contact's role on a specific deal (multi-threading; docs 6.11, 9)
  id        String  @id @default(cuid())
  workspaceId String
  dealId    String            // → Deal
  personId  String            // → Person
  role      String            // champion | decision_maker | economic_buyer | influencer | blocker | user | other
  isPrimary Boolean @default(false) // the primary contact on this deal
  @@unique([dealId, personId])
  @@index([personId])
}
```

This replaces Deal's flat `peopleIds[]` with a **role-carrying join**, so "Jane is the champion on Deal 1 but only an influencer on Deal 2" is expressible — which a Person-level `persona` cannot do. The deal's people list is now `DealContactRole` rows; `persona` on Person stays as the *default* role hint, `DealContactRole.role` overrides it per deal.
