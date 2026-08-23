# Doc 5a — CRM Data Ops & Hygiene (bulk, undo, dedupe, merge, trash, import, extension, retention, audit)

*Split from the old doc 5. That doc grew too big, so it is now three docs that keep their original journey numbers so cross-references still resolve:*
- **[Doc 5](5-comms-email-and-calendar.md)** — Comms: email, calendar, mailboxes, meeting recording.
- **This doc (5a)** — the record-level data operations: bulk actions, undo, duplicate hygiene, trash, CSV import, the Chrome extension, data retention, and the audit log.
- **[Doc 5b](5b-reporting-and-dashboards.md)** — reporting, dashboards, and user profiles.

**Why these journeys live together:** they are all ways a rep or admin *operates on records in bulk or over their lifecycle* — creating, cleaning, merging, undoing, deleting, and auditing them — independent of which channel produced the data. Benchmarks here are **Attio** (bulk edit, merge, delete), **HubSpot/Salesforce** (30-day recycle bin, duplicate management, import mapping), **Apollo** (Chrome extension), and **Google Sheets** (undo history).

**Convention reminder — background jobs.** Every background job states its **trigger**, its **algorithmic steps**, and its **pg-boss** params (queue, `retryLimit`, idempotency key, cron). Every UI journey states its **entry point** (how the user gets to the page) before its steps.

---

## New surfaces this doc adds

- **Bulk action bar** — slides up when rows are selected in any object table (Journey 5.1).
- **Undo toast + undo-history panel** — app-wide `⌘Z` / redo, and a list of recent reversible actions (Journey 5.1a).
- **Settings → Data health** — one page with three tabs: **Duplicates** review inbox, **Trash** (30-day recycle bin), and **Scan now** controls (Journeys 5.3, 5.14).
- **Settings → Data retention** and the **Audit log** viewer (Journey 5.14).
- **Chrome extension** side panel — add a Person from a LinkedIn profile via enrichment (Journey 5.13).

---

## Journey 5.1 — Bulk edit, delete, and add to a list

*As a rep or admin, I want to change, tag, or delete many records at once, so that I don't hand-edit hundreds of rows one at a time.*

Works in **any object table or list** — People, Companies, Deals, Calls, Emails, Meetings, Actions, and custom objects (doc 4.7).

**5.1.1 — Select the rows**

1. Hovering a row reveals a **checkbox** at the far left of the row (same column as the row grip). He ticks rows, shift-clicks to select a contiguous range, or clicks the **header checkbox** to select every row on the current page.
2. When the page is fully selected, a one-line bar appears above the grid: **"All 50 on this page are selected — Select all 1,240 across this filter."** Clicking it extends the selection beyond the visible page. Selected rows stay highlighted as he scrolls.
3. **The bulk action bar** slides up from the **bottom center of the table**, showing **"N selected,"** the action buttons, and an ✕ to clear the selection.

**UI precision — alignment (your "text boxes must line up" note).** This applies both to the inline-edit inputs in the grid and to the bulk-edit popover:
- Every editable cell's input and every header filter/search box shares **one left edge per column** and the **same width as its column**, so inputs form clean vertical columns, not a ragged staircase.
- Input text is **vertically centered** against the row height and sits on the **same baseline** as the static text in read-mode cells, so toggling a cell between read and edit never makes the text jump up or down.
- In the header, the column **label and its filter box are left-aligned to the same edge** as the data below them. (Numeric columns are the one exception: header label, filter box, and cell values are all **right-aligned** together.)
- We hold this with a shared grid template (fixed column widths, one cell-padding token), not per-cell styling — so a coding agent can't drift it row by row.

**5.1.2 — Pick an action**

The bulk action bar offers exactly these actions (this is the full list):
- **Edit a field** — set one field to one value on every selected row.
- **Add to list** (doc 4.10) or **Add to campaign** (doc 5).
- **Create task** — either one task linked to all selected records, or one task per record (a radio in the dialog).
- **Delete** — sends to the **30-day trash** (Journey 5.3d); never a hard delete.
- **Export** the selection to CSV (doc 8).

**5.1.3 — Bulk-edit UI, and matching the input to the field type (your 5.1.4 note)**

Clicking **Edit a field** opens a small popover: pick the field, enter/select the new value, read a one-line preview (*"Set Owner = Ryan on 1,240 records"*), then **Apply**. **The value input must match the field's type** — a text box is wrong for a status field. The mapping the builder must follow:

| Field type | Input component |
|---|---|
| Short text / email / URL / phone | single-line text input (typed validation for email/URL/phone) |
| Long text | multi-line textarea |
| Number / currency | numeric input (currency shows the unit prefix) |
| Date / datetime | date picker (datetime adds a time field) |
| Single-select / status / stage | dropdown of that field's defined options (chips, not free text) |
| Multi-select | multi-chip picker (with **Add to** vs **Replace** toggle) |
| Boolean | a two-option toggle (True / False) |
| Reference (Owner, Company, linked record) | a record-search picker that resolves to an entity chip |

This is the **same field→component map** the inline record editor uses (doc 4b), so there is one source of truth, not two.

**5.1.4 — Apply, confirm, and the "big job" path**

1. Ordinary edits apply on **Apply** with an **Undo** in the success toast (Journey 5.1a).
2. **Delete**, and any edit over the "big" threshold, first ask for an explicit **confirm**; a very large delete requires typing the record count to proceed.
3. **"Big" = more than ~200 rows.** Under that, it runs inline in about a second. Over it, the job runs in the background (`bulk-mutate` queue) and a **progress toast** shows a live count and percent — *"Updating 1,240 records… 63%"* — with **Cancel**. Affected rows show a faint "updating…" shimmer, **but the table is not locked** — he can scroll, open other records, and keep working. A success toast (with Undo where reversible) ends it; a partial-failure toast lists what failed and offers **Retry failed**.
4. Each write goes through field history (doc 4 job E1) and writes **one grouped audit entry** for the whole batch (Journey 5.14), not one row per record.

- **Background job — `bulk-mutate`.** **Trigger:** an Apply/Delete over ~200 rows. **Steps:** chunk the selection (~500/chunk), apply the field write or soft-delete per chunk through the normal record-write path (so field history + audit fire), update the progress counter, collect failures. **pg-boss:** `bulk-mutate` queue, `retryLimit: 3`, **idempotent per (batchId, recordId)** so a retried chunk never double-applies; `singletonKey = batchId` keeps one batch's chunks ordered; honors a cancel flag between chunks.
- **Benchmark (beat this):** Attio — managing your data / records (bulk edit + delete) — https://attio.com/help/reference/managing-your-data/records/merge-and-delete-records ; Airtable — bulk record editing (grid selection UX) — https://support.airtable.com/docs/managing-records
- **Build docs:** internal — the `bulk-mutate` queue + field history (doc 4 E1).

## Journey 5.1a — Undo and undo history (app-wide)

*As any user, I want a reliable undo — including a keyboard shortcut and a short history of what I can undo — so that a mistaken edit, bulk change, or delete never costs me work.*

**I agree with your instinct: yes, build app-wide undo, and make it a first-class story** (this is that story). It is a genuine differentiator — Attio and most CRMs give you Undo only in a fleeting toast, not a Google-Sheets-style history you can walk back. We already store **before→after diffs on every write** (field history, doc 4 E1) and an **audit log** (Journey 5.14), so the hard part — knowing the prior value — is already done. Undo is just "re-apply the `before` value as a new, normal write."

**How it behaves (the user's view):**
1. After any reversible action, a toast shows **"Owner set to Ryan on 1,240 records — Undo (⌘Z)."**
2. Pressing **⌘Z / Ctrl+Z** anywhere undoes the **last** reversible action the user took this session; **⌘⇧Z / Ctrl+Y** redoes it. The shortcut is suppressed while a text field or the composer has focus (there, ⌘Z is the browser's own text undo).
3. An **Undo history panel** (opened from the user menu, or `⌘Z` held / a small "History" chip on the toast) lists the last ~50 reversible actions this session, newest first: *"3:41pm — Deleted 12 People," "3:40pm — Set Stage = Won on 1 Deal."* Clicking one undoes **that action and everything after it** (a stack, like Sheets — you can't un-pour the third coffee while keeping the fourth).
4. Each entry shows a plain-English label and whether it is still undoable (see limits).

**How it works (the flow of data):**
1. Every user-initiated mutation pushes an **`UndoEntry`** onto a **per-user, per-session stack** held in memory (and mirrored to a small table so a reload within the session can still undo). The entry stores the **inverse**: for a field edit, the list of `(recordId, field, beforeValue)`; for a delete, the tombstone ids to restore; for an add-to-list, the entries to remove.
2. **Undo = run the inverse as a forward mutation** through the same write path (so it is itself audited, and itself redoable). It is **not** a database rollback — that would be wrong under concurrency (someone else may have touched the row since). If the current value no longer matches the `after` we recorded, we show *"This record changed since — undo anyway?"* rather than silently clobbering the newer edit.
3. Redo replays the original `after` values the same way.

**Limits (stated so it never lies about what it can do):**
- Undo covers **record writes**: field edits (single + bulk), create, delete/restore, merge-undo where reversible, list membership, task create. It does **not** cover irreversible external side effects — a **sent email or SMS**, a **placed call**, or a **hard delete** past retention — the toast for those says "Sent" with no Undo.
- A **big bulk job** is one undo entry (re-applies all `before` values via the same `bulk-mutate` queue), with the same progress toast.
- The stack is **per user and per session** — you can't undo a teammate's change (that's what field history + audit are for), and it clears on sign-out.

- **Benchmark (beat this):** Google Sheets — undo/redo history depth and the "undo the whole stack to here" model (behavioral reference; no public architecture doc) — https://support.google.com/docs/answer/187281 ; Linear — command-driven undo toasts — https://linear.app
- **Build docs:** command/inverse pattern over our existing before→after diffs; **immer `produceWithPatches` / `applyPatches`** for complex nested client state only — https://immerjs.github.io/immer/patches ; **zundo** (Zustand undo middleware) as the client stack helper — https://github.com/charkour/zundo . Server undo = compensating writes keyed to the session stack, never a DB-level rollback.

## Journey 5.3 — Record hygiene: auto-create, dedupe, merge, restore

*As a rep or admin, I want the CRM to fill itself with real contacts, catch duplicates, merge them cleanly, and let me undo a bad delete, so that the data stays complete and trustworthy without manual cleanup.*

Four distinct micro-journeys. **Attio** is the benchmark for auto-create/detect/merge; for **restore**, neither Attio nor Gong has a trash, so we beat them (benchmark **Salesforce/HubSpot's 30-day Recycle Bin**). Each sub-journey names its own benchmark, per your "benchmark per sub-journey" note.

### 5.3a — Auto-create a Person (and its Company) from an unknown participant

*As a rep, I want people I actually email or meet with to appear in the CRM automatically, so that I never lose a contact to manual data entry.*

- **Trigger:** the email/calendar matching engine (doc 5 Journey 5.2) sees a participant with **no matching Person**, on a **matched Company**, **and** the record-creation setting is not Off.
- **Who/when:** the system, silently, at sync time — no prompt.
- **What appears:** a new Person record materializes in the People list, linked to the meeting/email and to its Company.
- **End:** Person exists and is linked; dedupe (5.3b) is the safety net.

**"Selective" mode — what it actually means (your clarify).** The setting has three modes:
- **All** — create a Person for **any** participant on any matched-Company message (including people merely CC'd on a forward, or on a blast the rep received). Highest capture, most noise.
- **Selective (default)** — create a Person **only when a workspace user was a direct correspondent** with them: the user is in `To`/`From`/`Cc` **and** the unknown participant is too, i.e. real two-way correspondence — not someone who only appeared once, buried in a CC on a forwarded thread, or on bulk inbound. This is the "people you actually corresponded with" line.
- **Off** — never auto-create; matching still logs activity onto existing records.

**"Dedupe + 30-day trash make it low-risk" — what that means (your clarify).** Two safety nets sit under auto-create, which is why we default it ON-Selective:
1. **Dedupe (5.3b) runs on every auto-created record**, so if the person already exists under a slightly different spelling, we surface a merge instead of leaving a twin.
2. **Any wrongly-created record deletes to the 30-day trash (5.3d) and restores in one click** — nothing auto-created is ever destructive.

**Auto-create Companies from a domain is a job, not just a toggle (your clarify).** The "auto-create Companies from domains" switch turns on a real background step, not a passive flag:
- **Background job — `auto-create-company`.** **Trigger:** auto-create fires for a Person whose email domain has **no** existing Company (and the domain is not a public/personal domain — see doc 5 exclusions). **Steps:** (1) re-check for a Company on that exact domain and on its registrable parent domain (so `sub.acme.com` finds `acme.com`) to avoid a race; (2) if still none, create a Company with `name` derived from the domain (title-cased second-level label, e.g. `acme.com → "Acme"`), `domain` set, `source = auto`; (3) enqueue enrichment (doc 7.7) to fill the real legal name/logo/size later; (4) link the Person to it. **pg-boss:** `auto-create-company` queue, `retryLimit: 3`, **idempotent on `workspaceId+domain`** (a unique index on Company.domain guarantees one Company per domain even under concurrent messages).

**Settings — where and who (path + admin scope).** **Settings → Integrations → Record creation** (workspace-wide, **admin-only**; **not retroactive** — it changes behavior going forward, it does not sweep old mail). Fields: **Create People** = All / Selective (default) / Off; **Auto-create Companies from domains** = on/off. A non-admin sees this section **read-only** with a note "Set by your admin," so it is obvious the choice governs the whole workspace.

- **Benchmark (beat this):** Attio — how email/calendar sync auto-creates and enriches records — https://attio.com/help/reference/email-calendar/email-and-calendar-syncing
- **Build docs:** internal — the `auto-create-company` queue + the doc-5 matching engine (5.2).

### 5.3b — Detect a duplicate

*As an admin, I want likely duplicate records flagged for review, so that the CRM stays clean without me eyeballing every new row.*

- **Trigger:** three ways — (1) a record is created; (2) a **key field** changes; (3) a manual **Scan for duplicates** (below). All route to job **F3**.
- **Who/when/what appears:** asynchronously, to the record owner and admins — as a **row in the Duplicates review inbox** (not a blocking popup at create time), plus a small **"Possible duplicate" badge** on each affected record.

**What is a "key field," and do we dedupe only on those? (your clarify.)** A **key field** (we also call it an **identity field**) is a field whose value is meant to be **unique to one real-world entity** — for People: **email, phone, LinkedIn URL**; for Companies: **domain**. Dedupe keys on identity fields **plus a name+company fuzzy match** — it does **not** compare every field (matching on "same job title" would flag half the database). The identity-field set ships sensibly pre-configured and an admin can mark additional fields as identity fields at **Settings → Data health → Matching rules**. So: exact match on any identity field = strong duplicate; fuzzy name + same Company = likely duplicate.

**Name-aware matching — how it works, and the open-source we lean on (your ask).** The scan **normalizes and canonicalizes names** before comparing, so diminutives collapse:
1. Normalize: lowercase, strip punctuation/accents/extra whitespace.
2. **Canonicalize the first name through a nickname map** so "Matt" ↔ "Matthew", "Bob" ↔ "Robert", "Liz" ↔ "Elizabeth" resolve to one key — using the open-source **carltonnorthern/nicknames** dataset (a curated CSV of ~1,100 US given-name↔nickname pairs).
3. **Block, then score:** only compare records that share a cheap key (same normalized last name, or same email domain) — the *blocking* idea borrowed from **dedupe.io** — then score the remaining pair with **fuzzball** `token_set_ratio` (a JS port of RapidFuzz), adding **natural**'s Soundex/Metaphone for phonetic near-misses (Katherine/Catherine). This keeps it from being O(n²) on a big table.

So "Matt Smith @ Acme" and "Matthew Smith @ Acme" surface as one likely duplicate rather than two people. (This is the same nickname capture that powers `preferredName` in doc 7.)

**What the badge and the review inbox look like (your clarify).**
- **"Possible duplicate" badge:** a small **amber pill** reading "Possible duplicate" on the record header and on its table row; clicking it jumps to the matched pair. Benchmark: **HubSpot's duplicate-management** flags. Amber (not red) because it's a suggestion, not an error.
- **The Duplicates review inbox** is **not** a navbar item and **not** one giant mixed table. It lives at **Settings → Data health → Duplicates**, grouped by object type (People / Companies / Deals tabs), one **row per candidate pair**, each showing both records, the **reason** (same email / same domain / same phone / name+company), and a confidence chip. This keeps duplicate cleanup an intentional admin chore, not clutter in the reps' daily tables.

**How you reach "Scan for duplicates," and what happens (your clarify).** Two entry points:
- **Settings → Data health → Duplicates → "Scan now"** (whole workspace, or one object type).
- Any object table's **⋮ menu → "Scan this view for duplicates"** (just the filtered rows).

Journey: he clicks Scan → a toast "Scanning People for duplicates…" → job F3 runs → on completion the Duplicates inbox badge shows the new count and a toast links to it. It never blocks his current page.

**Benchmark to measure name-matching against (your "do we have a benchmark" ask).** We hold F3 to a **precision-first bar**: on a labeled fixture set (reuse the eval-fixtures pattern from doc 7a), **≥95% of surfaced pairs are true duplicates** (precision — false flags are the expensive mistake here) at **≥80% recall** on the nickname/typo cases. The fixtures include the diminutive pairs, accented spellings, and "same name, different company" (which must **not** flag).

- **Next action:** a **Review** button on the pair → opens the two records side by side → **Merge** (5.3c). The flag persists until resolved or dismissed as "Not a duplicate" (which records a negative example so we don't re-flag it).
- **Background job — F3 (duplicate scan).** **Trigger:** create, key-field change (debounced), or a manual scan. **Steps:** block → canonicalize names → score candidate pairs → write a `DuplicateFlag(open)` for any pair over threshold, skip pairs previously dismissed. **pg-boss:** `dedupe-scan` queue, `retryLimit: 2`, `singletonKey = workspaceId+objectType` for the manual full-scan (one at a time), debounced per record for the change-triggered path.
- **Benchmark (beat this):** Attio — check for duplicates app — https://attio.com/apps/check-for-duplicates ; HubSpot — manage duplicates — https://knowledge.hubspot.com/records/manage-duplicate-records
- **Build docs:** **carltonnorthern/nicknames** — https://github.com/carltonnorthern/nicknames ; **fuzzball.js** — https://github.com/nol13/fuzzball.js ; **natural** (phonetic) — https://github.com/NaturalNode/natural ; dedupe.io (blocking approach, inspiration) — https://github.com/dedupeio/dedupe

### 5.3c — Merge two records

*As a rep, I want to merge a duplicate pair into one clean record without losing either one's history, so that the surviving record is complete.*

- **Trigger:** the user clicks **Merge** (from a duplicate row or a record's ⋮ menu).
- **What the review + merge screen looks like (your UI-benchmark ask):** the two records appear **side by side**, survivor on the right with a **swap arrow** to flip which side wins. **We beat Attio here:** Attio does a blanket "right record wins"; we offer a **field-by-field picker** for every conflicting field (a radio per field, "keep survivor" pre-selected), a live **preview of the combined result**, and counts of what carries over ("+3 notes, +2 emails, +1 open deal"). Benchmark the layout against **HubSpot's merge** (two-column compare) and **Salesforce's merge wizard** (per-field winner selection) — both show the pattern with screenshots.
- **Actions:** choose survivor → resolve any conflicting fields → confirm. **Both timelines** (notes, calls, emails, events, tasks) re-point to the survivor: they carry a `recordId`, so we **rewrite the pointer, we don't copy**. The loser is **tombstoned** via `mergedIntoId` (old links to it still resolve to the survivor), and the winning value per field is recorded in `MergeRecord`.
- **End:** one merged record. **Confirm before running** — a merge is irreversible beyond the audit trail, so it is **not** on the ⌘Z stack (the toast says "Merged," no Undo); to reverse, an admin restores from the `MergeRecord`/tombstone, which is a deliberate admin action.

- **Benchmark (beat this):** HubSpot — merge records — https://knowledge.hubspot.com/records/merge-records ; Salesforce — merge duplicate records — https://help.salesforce.com/s/articleView?id=sf.duplicate_prevention_merge.htm&type=5 ; Attio — merge (the bar we beat with field-by-field) — https://attio.com/help/reference/managing-your-data/records/merge-and-delete-records
- **Build docs:** internal — pointer rewrite + `MergeRecord`.

### 5.3d — Restore from the 30-day trash

*As a rep or admin, I want deleted records held for 30 days and restorable in one click, so that a mistaken delete is never permanent.*

- **Trigger:** any delete (or a merge retiring the loser) drops the record into **Trash**.
- **Entry point (your "how to access Trash" ask):** **Settings → Data health → Trash**. Also, every object table's **⋮ menu → "Show deleted"** opens the Trash filtered to that object, so a rep who just deleted the wrong row finds it right where he was working.
- **What appears:** a Trash table listing name, type, **who deleted it**, **when**, and an **auto-purge countdown** ("purges in 27 days").
- **Header copy (your "tell users it auto-purges" note).** A one-line banner at the top of Trash reads: **"Items here are kept for 30 days, then permanently deleted."** Next to it, an ⓘ tooltip: *"Restoring brings back the record and all its linked notes, calls, emails, and tasks. After 30 days, items can't be recovered."* This sets expectations without a wall of text.
- **Actions:** **Restore** (rehydrates the record + its relationships/timeline) or, admin-only, **Delete permanently** (and a **Purge now** for the whole trash — Journey 5.14).
- **End:** restored to live data, or auto-purged at day 30 (job **F6**).

- **Benchmark (beat this):** Salesforce — recycle bin — https://help.salesforce.com/s/articleView?id=sf.home_delete.htm&type=5 ; HubSpot — restore deleted records — https://knowledge.hubspot.com/records/restore-deleted-records
- **Build docs:** internal — soft-delete flag + F6 purge.

## Journey 5.12 — Import a CSV into CRM objects

*As a rep or admin, I want to import a spreadsheet into any object, so that I can bring in a list without retyping it.*

1. On any object's table, the user clicks **Import** and gets the **same import widget defined in the at-scale doc (Journey 3.1)** — file check, auto-map columns, dedupe (job D1), merge/skip/allow per row or in bulk.
2. The one difference: the target is a **CRM object** (People, Companies, Deals, or a custom object), so mapping offers that object's fields, including custom and reference fields.
3. He imports; the rows land as records, ready to use. Newly imported records also run through dedupe (5.3b), so an import that overlaps existing data surfaces merge candidates rather than creating twins.

*We do not redefine the widget — it is one shared component. This journey only notes it also writes into CRM objects.*

- **Benchmark (beat this):** HubSpot — import objects (mapping + dedupe) — https://knowledge.hubspot.com/import-and-export/import-objects
- **Build docs:** shared — see dialer-at-scale Journey 3.1 (PapaParse — https://www.papaparse.com/docs).

## Journey 5.13 — Chrome extension: add a Person from a LinkedIn profile [P3]

*As a rep, I want to add the person whose LinkedIn profile I'm looking at into the CRM in one click, so that prospecting on LinkedIn feeds the CRM without copy-paste.*

**Design change (your call — I agree): don't scrape the profile, enrich from the URL.** LinkedIn's terms prohibit scraping profile content "through any means (including browser plugins)." So instead of reading name/title/company out of the page DOM, the extension reads **only the canonical profile URL** (the `/in/{slug}` from the address bar — public, not scraped content) and **runs the same enrichment waterfall our in-app enrichment already uses** (doc 7.7), keyed on that LinkedIn URL. This gets us the same data with far less ToS and reliability risk, and reuses code we already own. Benchmark: **Apollo's** extension model (side panel, one-click, provider-backed data — not bulk DOM harvesting).

1. **Trigger** — the user clicks our toolbar icon on a `linkedin.com/in/...` page. **Manual click only — never auto-run.**
2. **Read the URL, then enrich** — a content script reads the canonical `/in/` URL (and nothing else from the page). The service worker calls our enrichment providers with that URL and pre-fills an **editable "Add Person" form** in the side panel with name, title, company, location, and work email/phone **from the enrichment provider**, each showing its **source + confidence**. If the provider returns nothing, the form opens with just the LinkedIn URL and the rep fills the rest — no page scraping either way.
3. **Dedupe before save** — call our CRM with the profile URL (primary key) + name+company fallback. On a match, show **"Already in CRM — open / update"** instead of creating a duplicate (reuses 5.3b logic).
4. **Save** — create **Person** and, if new, the linked **Company** (via the `auto-create-company` job, 5.3a); optionally add to a list in the same action.
5. **Bulk-add** — on a search / Sales Nav results page, the extension collects the **`/in/` URLs of rows the user selected** (again, URLs only) → queues them → enriches + saves as a batch. One manual action per batch the user initiated; no background crawl or auto-pagination.

**Technical approach (MV3):** a content script on LinkedIn URLs reads **only the `/in/` slug** (URL parsing, not content scraping); a **side panel** hosts the form; a **service worker** holds the auth token and makes all CRM + enrichment API calls (**never put keys or provider calls in the content script**).

**Why this is lower-risk than DOM scraping (spec it, don't hide it):** we no longer read protected profile content, so the main scraping-ToS exposure drops — we're treating the LinkedIn URL like any other identifier the rep pastes into enrichment. Residual norms we still respect: one manual action = one profile (no auto-crawl), act only on pages the user opened, and keep provider volume within our enrichment rate limits. Selector fragility largely goes away because we don't depend on profile-DOM selectors — only the stable `/in/` URL.

- **Benchmark (beat this):** Apollo — prospect on LinkedIn with the Chrome extension — https://knowledge.apollo.io/hc/en-us/articles/4409229262093-Prospect-on-LinkedIn-with-the-Apollo-Chrome-Extension
- **Build docs:** Chrome — extensions Manifest V3 — https://developer.chrome.com/docs/extensions/develop ; reuses our enrichment waterfall (doc 7.7).

## Journey 5.14 — Data retention, deletion, and the audit log

*As an admin, I want to set how long data is kept, purge it on demand, and see a full history of who changed or exported what, so that we meet retention/privacy obligations and can investigate any change.*

Two related capabilities: **retention** (rules that eventually hard-delete data) and the **audit log** (a searchable record of every change and export).

### 5.14a — Set a retention rule and purge

*As an admin, I want data to auto-delete on a schedule I set, so that we meet retention and privacy obligations without manual cleanup.*

1. **Entry point:** **Settings → Data retention.** He clicks **Add rule**, picks a **data type** (call recordings, transcripts, emails, calls, records) and an **expiry** (e.g. delete after 12 months). A **legal-hold** flag exempts records that must be kept.
2. **Job F6** hard-deletes matching data on its expiry date (this is the real, permanent delete path — distinct from the user-reversible 30-day trash).
3. **Delete-everything-now (your ask).** Next to each rule, a **"Purge matching data now"** button runs F6 immediately for that rule instead of waiting for the nightly pass — with a **typed-confirmation** dialog ("This permanently deletes 4,120 call recordings. Type DELETE to confirm."), because it is irreversible. The same **Purge now** exists on the Trash view to empty the 30-day trash on demand.

**How relationships affect a delete (your cascade question).** When we delete an object that another object depends on, we do **not** blindly cascade. The rule per relationship type:
- **Owned children** (a Deal's own notes, a Call's transcript, an Email's body) → **cascade**: they delete/purge with the parent, since they have no meaning without it.
- **Referenced entities** (a Person linked to a Deal; a Company linked to many People) → **restrict / re-point, never silent cascade**: deleting a Company that still has People does **not** delete those People. Instead the delete either (a) is **blocked** with "12 People are linked to this Company — reassign or delete them first," or (b) proceeds and the children become **unlinked** (the reference is nulled) — the admin chooses the default at **Settings → Data retention → On delete of a referenced record**. Default is **block-and-warn**, the safe option.
- **Activities that log against a record** (emails/meetings matched to a Company) → keep the activity, null the link, so history and reporting aren't silently punched full of holes.
- **Merged/tombstoned records** are never independently deletable — they follow their survivor.

Retention deletes obey the **same relationship rules**; a legal hold on any child blocks the parent's hard-delete until the hold clears.

- **Background job — F6 (retention + trash sweep).** **Trigger:** nightly cron, plus on-demand "Purge now." **Steps:** find data past its `expireAfterDays` (skip `legalHold`); empty trash items older than 30 days; drop unmatched-email holds older than 30 days (doc 5.2); apply the relationship rules above; write a grouped audit entry. **pg-boss:** `retention-sweep` queue, daily cron, `retryLimit: 3`, idempotent per (ruleId, day).

### 5.14b — Read the audit log

*As an admin, I want to see who changed or exported what and when, so that I can investigate a mistake or satisfy a compliance/security request.*

- **Entry point (your "how does the user access it" ask):** **Settings → Audit log** (admin-only — see access below). It also has a per-record shortcut: a record's ⋮ menu → **"View history"** opens the audit log pre-filtered to that record.
- **Who can access it (your ask):** **admins and superadmins only.** A rep cannot open the workspace audit log (it exposes other users' actions); a rep sees only their **own** field history on records they can see (doc 4). Superadmins (our staff) can read it from the superadmin console (doc 13) for support.
- **What it looks like (your ask):** a dense, filterable table, newest first, one row per event:

```
When              Who         Action    Object            Change
Aug 19, 3:41pm    Ryan H.     update    Deal · Acme Q3    Stage: Qualified → Won
Aug 19, 3:40pm    Ryan H.     delete    Person · J. Doe   (moved to trash)
Aug 19, 2:10pm    Dana K.     export    People (view)     1,240 rows → CSV
Aug 19, 1:55pm    system      merge     Person · M.Smith  merged M.Smith ← Matt Smith
```

  Each row expands to the full old→new diff. Columns: **When, Who, Action** (create / update / delete / merge / export), **Object type + name, Change summary.**
- **The journey:** admin opens it → **filters** by user, object type, action, or date range → clicks a row to expand the diff → **Export** the filtered log to CSV for an auditor. Bulk edits appear as **one grouped entry** ("Set Owner = Ryan on 1,240 records"), expandable to the affected ids, so a bulk change doesn't flood the log.

- **Benchmark (beat this):** Salesforce — field audit trail — https://help.salesforce.com/s/articleView?id=sf.field_audit_trail.htm&type=5 ; Vanta/Drata-style audit-log viewers (filter + export UX)
- **Build docs:** internal — the `AuditLog` table (below).

---

## Background jobs (this doc)

- **F3 — Duplicate scan.** Flag likely duplicates and surface a merge suggestion. Trigger/steps/pg-boss in Journey 5.3b. Periodic + on create/change + manual.
- **F6 — Retention + trash sweep.** Hard-delete expired data, empty the 30-day trash, drop stale unmatched holds. Trigger/steps/pg-boss in Journey 5.14a. Daily cron.
- **`bulk-mutate`** (Journey 5.1) and **`auto-create-company`** (Journey 5.3a) are defined inline above.
- *Referenced from doc 5:* **F2 (auto-create + relate)** runs the matching engine (doc 5.2) that triggers 5.3a; it is owned and specced there.

## Monitoring & health (jobs in this doc, and the shared pattern)

All jobs here run on the shared pg-boss runner (doc 12), so they inherit its health surface: **queue depth, failure rate, and dead-letter count per queue**, emitted to Axiom with an alert "failed jobs > N in 10 min" (doc 12). Job-specific health we watch: **F3** — duplicate-flag rate (a spike means a bad matching rule); **F6** — rows purged per night vs expected, and any purge blocked by a legal hold (surfaced, not silently skipped). The superadmin console (doc 13) shows per-workspace job history.

## Data model (Prisma) — additions in this doc

Extends the cumulative schema. New models marked `// NEW`; `// added` marks new fields on existing models.

```prisma
model Record {
  // ...existing fields, plus:
  mergedIntoId String?   // added: tombstone pointer after a merge (Journey 5.3c)
  deletedAt    DateTime? // added: soft-delete → 30-day trash (Journey 5.3d)
  deletedById  String?   // added: who deleted it (Trash + audit)
}

model DuplicateFlag {         // NEW — Journey 5.3b (a detected duplicate pair)
  id          String   @id @default(cuid())
  workspaceId String
  objectType  String
  recordAId   String
  recordBId   String
  reason      String   // same_email | same_phone | same_domain | name_company
  confidence  Float
  status      String   @default("open") // open | merged | dismissed
  createdAt   DateTime @default(now())
  @@index([workspaceId, objectType, status])
}

model MergeRecord {           // NEW — Journey 5.3c (audit of a merge, enables admin un-merge)
  id           String   @id @default(cuid())
  workspaceId  String
  survivorId   String
  mergedId     String   // tombstoned record
  fieldsJson   Json     // which value won per field
  createdAt    DateTime @default(now())
}

model UndoEntry {             // NEW — Journey 5.1a (per-user session undo stack)
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  sessionId   String
  seq         Int              // stack order
  label       String           // "Set Owner = Ryan on 1,240 records"
  inverseJson Json             // (recordId, field, beforeValue)[] or restore ids
  redoJson    Json             // the 'after' values, for redo
  undone      Boolean  @default(false)
  createdAt   DateTime @default(now())
  @@index([workspaceId, userId, sessionId, seq])
}

model RetentionPolicy {       // NEW — Journey 5.14a
  id          String  @id @default(cuid())
  workspaceId String
  dataType    String  // recordings | transcripts | emails | calls | records
  expireAfterDays Int
  legalHold   Boolean @default(false)
}

model AuditLog {              // NEW — Journey 5.14b (every change + export)
  id          String   @id @default(cuid())
  workspaceId String
  actorId     String   // userId or "system"
  action      String   // create | update | delete | merge | export
  objectType  String
  objectId    String
  diffJson    Json?    // old -> new
  batchId     String?  // groups a bulk edit into one logical entry
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
}
```

## Technical decisions, trade-offs & edge cases

- **Undo is compensating writes, not DB rollback** (Journey 5.1a): each undo re-applies the recorded `before` value through the normal write path, so it is concurrency-safe, itself audited, and redoable. If the live value drifted since the action, we prompt rather than clobber. Sent emails/SMS/calls and post-retention hard-deletes are excluded from undo because they have irreversible external effects.
- **Dedupe/merge keeps both timelines** (Journey 5.3c): the survivor keeps its own non-blank fields and borrows blanks from the loser; **all** timeline items re-point to the survivor (they carry a `recordId`, so we rewrite it, we do not copy). The loser is tombstoned via `mergedIntoId` so old links still resolve. Record the winning value per field in `MergeRecord` for admin un-merge/audit. Merges are irreversible in the normal UI beyond the audit trail — confirm before running.
- **Retention hard-delete vs legal hold** (F6): expiry deletes are permanent and skip `legalHold` records. This is the real hard-delete path, distinct from the 30-day trash — trash is user-reversible, retention is compliance-driven. Relationship rules (Journey 5.14a) apply to both.
- **Audit-log volume** (`AuditLog`): every change and export writes a row, so this table grows fast. Index by `(workspaceId, createdAt)`, write compact diffs, group bulk edits under one `batchId`, and roll old logs to cold storage on their own retention clock.
- **Duplicate precision over recall** (F3): a false duplicate flag wastes an admin's time and risks a bad merge, so F3 tunes for **precision** (≥95% on fixtures) and records every "Not a duplicate" dismissal as a negative example so the same pair is never re-flagged.

## Decisions for you (data ops)

**1. App-wide undo — build it now, or defer?**
- **Build it now (my pick).** We already store before→after diffs, so the cost is a session stack + a shortcut + a history panel. It's a real differentiator vs Attio's toast-only undo, and it de-risks bulk edits and auto-create.
- **Defer to toast-only Undo.** Cheapest, but no history and no keyboard-driven confidence; we'd rebuild later.

**2. On delete of a referenced record — block, or unlink?**
- **Block-and-warn by default (my pick).** Deleting a Company with linked People stops and explains, so no one silently orphans data. Admin can switch a rule to auto-unlink.
- **Auto-unlink.** Fewer clicks, but easy to lose relationships by accident.
