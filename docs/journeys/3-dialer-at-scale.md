# Doc 3 — Dialer at Scale: import, call lists & power dial

Same journey format as doc 1. This is the first of the "at scale" docs:

- **Doc 3 (this file)** — CSV import, what a "call list" really is, and power dial.
- **Doc 3a** — voicemail drop, number health, local presence, SMS, live transfer, presence, notifications, hold, the browser extension, and compliance (DNC, dead numbers/emails, calling hours, dial order).
- **Doc 3b** — dialer analytics.

**Journey numbers are stable across the split** — 3.1 is still 3.1, 3.14c is still 3.14c, just in a different file (same convention doc 4 used). Cross-doc links keep working.

**Phase:** this builds **after the CRM (doc 4)**, because "at scale" needs the CRM's objects, fields, lists, and saved views. There is **no separate "call list" object** — a call list is a **CRM list or view of People** (doc 4c). This doc adds two things the CRM doesn't have: the **CSV import widget** (Journey 3.1, the canonical one the whole app reuses) and the **power-dial session** (Journey 3.4).

Under each journey: **Benchmark (beat this)** = the product to match, with a link where you can see how it works. **Build docs** = the page that tells the coding agent how to build it.

---

## New surfaces this doc adds

- **Import widget** — a CSV importer opened from any object's table (canonical; doc 5's CRM import reuses it).
- **Power-dial popover** — opened on a CRM list or view; no new page.
- **Power-dial progress strip** — a small stats bar shown *during* a power-dial session (called / remaining / connect rate).

Everything else at scale (voicemail, numbers, SMS, transfer, compliance) is in **doc 3a**; analytics is in **doc 3b**.

---

## Journey 3.1 — Import a CSV of people into the CRM

*As a rep, I want to upload a spreadsheet of prospects and have them land as clean People records, so that I can start calling them without hand-typing anything.*

This is the **canonical import widget** for the whole app. Doc 5 Journey 5.12 (import into any CRM object) and the dialer both reuse this exact component — it is defined **here, once**.

1. **Entry point.** On the **People** table (doc 4c Journey 4.7), he clicks **Import** in the table's top-right actions (next to *New*). Onboarding also links here ("Import your list"). A file picker / drag-drop zone opens inside a modal.
2. **Drop the file.** He drops a `.csv`. The widget checks the file (size, encoding, that it parses) and shows the first ~20 rows as a preview grid. **PapaParse streams the file** so a 100k-row file never freezes the tab (job **D1**).
3. **Map columns.** Each CSV column gets a dropdown mapped to a People field (name, phones, email, company, custom fields). We **auto-map** obvious headers ("Phone", "Email", "First Name") and leave the rest for him to set or skip. Phone columns are labeled by type if we can tell (mobile / office).
4. **Pick the match fields (dedupe).** He chooses what makes a row a duplicate — **email**, **phone**, or **name + company**. As rows parse we **normalize every phone to E.164** (see doc 3a Journey 3.14c) and flag rows that match an existing record.
5. **Preview + resolve duplicates.** He sees a summary — *"1,204 rows · 38 new-but-duplicate · 6 will be skipped"* — and picks **merge / skip / allow** per row, or once in bulk for all duplicates.
6. **Import.** He clicks **Import**. Rows land as People records. A **hygiene pass** (doc 3a job **D9**) then marks any dead/**unreachable** numbers in the background — the rows are usable immediately; the health column fills in as it finishes.

**Edge cases (broken out):**
- **A phone won't normalize** (too few digits, junk) → the row still imports, but that phone is flagged **unreachable** (doc 3a Journey 3.14c), not dropped. He never loses data to a typo.
- **A column is left unmapped** → its data is ignored (shown greyed in preview), never guessed.
- **Re-importing the same file** → dedupe catches it; nothing double-creates (this is why the match fields exist).

- **Benchmark (beat this):** Attio — import records (clean column-mapping + dedupe UX) — https://attio.com/help/reference/importing-data/importing-records-via-csv
- **Build docs:** PapaParse (streaming CSV in the browser) — https://www.papaparse.com/docs ; job **D1** (doc 3a background jobs).

## Journey 3.1a — Import a CSV of companies (and link people to them)

*As a rep, I want to import a list of companies and have my people link to the right account, so that I can build account lists without hand-linking everyone.*

Your question — yes, we need this, because companies dedupe and link differently from people. It's the **same widget** (Journey 3.1), pointed at the **Companies** object, with three company-specific differences.

1. **Entry point.** On the **Companies** table (doc 4c Journey 4.7), he clicks **Import** — the same importer as 3.1.
2. **Map columns to Company fields** (name, **domain**, industry, size, custom/reference fields) — not People fields.
3. **Dedupe by domain, not phone.** A company's identity is its **domain** (best) or, if missing, its **normalized name** — companies don't have one phone/email to match on. Same-name / different-domain = different companies (domain wins).
4. **Link people to companies (the relationship, doc 4 Journey 4.6).** Two paths:
   - **Importing people (Journey 3.1) with a Company column** → we match that value to an existing company (by name/domain) and **link the person**; if no company matches, we **create a stub company** and flag it for review (never silently drop the link).
   - **Importing companies first, then people** → the people import links by the same Company column.
5. **Import.** Companies land; people attach to their accounts; account lists/views (Journey 3.2) now work.

- **Benchmark (beat this):** Attio — import records *(companies + people, with reference-linking on import)* — https://attio.com/help/reference/importing-data/importing-records-via-csv
- **Build docs:** reuses the Journey 3.1 widget + job **D1**; person→company link = doc 4 Journey 4.6.

---

## Journey 3.2 — Your call list is a CRM list or a view (there is no "call list" object)

*As a rep, I want to point the dialer at a list or a filtered view of people, so that I can call down exactly the set I want, in the order I want, without building a separate "call list" thing.*

The dialer does not own a list. It calls down one of three CRM things, all defined in **doc 4c**. This journey exists to (a) say clearly which three, (b) answer your open questions, and (c) point at the doc-4 journeys instead of redefining them.

**The three things you can dial (know the difference):**

| Name | What it is | Membership | Order |
|---|---|---|---|
| **List** | A hand-picked (or filter-fed) set of records with its own list-only fields. Doc 4c **Journey 4.10**. | **Fixed** — you add/remove records by hand (or a filter feeds it). | **Saved.** You drag rows to set the order; it sticks (`ListEntry.position`). |
| **Saved view** | A named, saved table setup — columns, filter, sort, group — over an object. Doc 4c **Journeys 4.8 / 4.9 / 4.9a**. | **Dynamic** — recomputed from the filter every time you open it. | **Recomputed** from the view's sort each time. |
| **Working view** | The arrangement you're looking at *right now* that you haven't saved — a filter you just typed, a sort you just clicked. Doc 4c calls this "live view state" (it lives in the URL). | Dynamic. | From the current sort. |

*Terminology (your open question — answered):* we call the unsaved one a **"working view"** in dialer copy, to separate it from a **saved view** and from a **list**. Recommend doc 4c adopt "working view" as the friendly name for its "live view state" too, so the three words stay consistent app-wide. *(Cross-doc note for doc 4c — small copy addition, no model change.)*

**Building a call list — three ways, all in the CRM (doc 4c 4.10):**
1. **Filter, then select → Add to list.** Filter the People table, checkbox the rows, click **Add to list** (4.10 step 1).
2. **A filter-fed list** ("No answer in 7 days") that refreshes its membership.
3. **Import (Journey 3.1), then Add to list.**

**Your open questions — answered:**

- **Do we save the order of a list?** **Yes.** A list is static, so a hand-set order is meaningful and should persist. Doc 4c already stores it as `ListEntry.position` (drag to reorder). **The dial order *is* the list order.** *I'm confident here.*
- **Do we save the order of a view?** **No — recompute it each time.** A view's membership and field values change (someone gets a new disposition, a call ages past 7 days), so a frozen per-row order would rot. We recompute from the view's sort. **But** for a power-dial *session* we **snapshot the order at the moment you hit Start** so the list doesn't reshuffle under you mid-session (Journey 3.4). *I recommend this but can be persuaded — the only real alternative is letting a view remember a manual order, which then fights the filter; I think that confuses more than it helps.*
- **Where are the buttons?** All list/view controls are doc 4c's, not new here. Filter / Sort / Group / Fields / Row-height sit on the **horizontal view toolbar above the grid** (doc 4c Journey 4.8); **Add to list** is on the selection action bar; **New list** is in the object's list switcher. The dialer only adds **one** button — **Power dial** — described in 3.4.
- **Two small list gaps to fill in doc 4c (you listed them).** Doc 4c Journey 4.10 covers create / add-remove / reorder / list-only-fields, but does **not** yet spell out **"rename a list"** or **"show all records"** (clear a filter to see everything) as explicit steps — and views have a rename (4.9a) while lists don't. These are small doc-4c additions, not dialer work. *(Cross-doc note for doc 4c.)*
- **Summary stats up top?** Doc 4c does **not** currently have a summary-stat bar over the table (only per-group and per-kanban-column counts). Two clean options: (a) add a general **table summary strip** to doc 4c (count, and sums for numeric columns — an Attio-style footer/header), or (b) keep stats out of the CRM table and show them only in the **power-dial progress strip** (3.4), which is dialer-specific (called / remaining / connect rate). **My pick: both, but separately** — a light general strip belongs in doc 4c (flagged there), and the live session stats belong to the dialer (3.4). This keeps the CRM table from growing dialer-only chrome. *(Cross-doc note for doc 4c.)*

**Benchmarks (your note — Apollo dropped):** the benchmark for lists, views, and the table is **Attio**. **We are not benchmarking Apollo** for this — you're right that its filter bar is sluggish and hard to read. **Google Sheets** is a benchmark only for *editing feel and motion* inside a cell (doc 4c Journey 4.7 already scopes it that way); for **list/view management** Sheets is strictly dominated by Attio, so it is not a benchmark here.

*Old journeys 3.1 (CSV import from a saved view) and 3.3 (work the list) fold into this journey and Journey 3.1 — verified covered by doc 4c lists/views + the import widget above.*

- **Benchmark (beat this):** Attio — understanding lists *(the list-vs-view data model + membership rules we're leveraging)* — https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists ; Attio — views *(the readable filter/sort toolbar we prefer over Apollo's)* — https://attio.com/help/reference/attio-101/records-lists-and-views
- **Build docs:** reuses doc 4c (lists `ListEntity`/`ListEntry`, views `SavedView`) + the import widget (Journey 3.1). No new model here.

---

## Journey 3.4 — Power dial down a list or a view

*As a rep, I want to press one button and have the app auto-dial down my list one person at a time, pausing only for me to talk and disposition, so that I make far more calls per hour without babysitting the dialer.*

This is the one thing the dialer adds on top of a CRM list/view. Single-line (1:1): one call at a time, a rep always waiting — so it is structurally compliant (no abandoned calls). Parallel/predictive dialing is a separate, heavily-guarded later mode (doc 3a Legal note).

1. **Entry point.** He opens a **list** or a **view** of People (Journey 3.2) and clicks **Power dial** — a button on the table's top-right actions, next to *Import*. (On a saved or working view, the same button appears.)
2. **The popover.** A small popover confirms: **how many** people are in the run, the **delay between calls** (a countdown, default **3s**, so he gets a breath — he can turn it off or set 0–30s in Settings → Dialer, doc 3a), and a **Start** button. It also shows what will be **auto-skipped**: DNC-blocked and outside-calling-hours rows (doc 3a 3.14a / 3.14b).
3. **Snapshot the order (the list-vs-view difference).**
   - **If it's a list:** the run uses the saved manual order (`ListEntry.position`).
   - **If it's a view (saved or working):** we **compute the order from the view's sort once, at Start, and freeze it for the session** — so new matches don't inject and the set doesn't reshuffle while he's dialing. New matches picked up next time he starts.
4. **Start.** The app dials the first person in order. The row **lights up and stays in view** in any open table (doc 4b Journey 4b.8). DNC and calling-hours are checked per row and blocked rows are skipped with a reason (doc 3a).
5. **Talk, then disposition.** He talks; on hang-up the **disposition bar** appears (doc 2 Journey 2.4) — one keystroke to disposition and auto-advance.
6. **The delay, then the next call.** After disposition the app waits the countdown (a **Skip** button jumps ahead immediately), then auto-dials the next person.
7. **Pause / stop.** A **Pause** button halts after the current call; **Stop** ends the session. A **progress strip** shows **called / remaining / connect rate** for the run.

**Edge cases (broken out):**
- **A row becomes DNC or outside hours mid-session** → it's skipped when reached, with a visible reason chip; the session continues.
- **He closes the list table mid-session** → the session keeps going from the dialer widget (the widget shows who's next); reopening the list re-lights the current row.
- **The list empties (all called)** → the session ends with a summary ("42 dialed · 9 connected · 6 voicemails").

- **Benchmark (beat this):** PhoneBurner — QuickStart: start dialing [visual: video walkthrough of a live dial session] — https://support.phoneburner.com/hc/en-us/articles/36410902719252-QuickStart-Start-Dialing + the dialing FAQ [how it works: attended-dialer rules] — https://support.phoneburner.com/hc/en-us/articles/115004996246-How-do-I-start-a-Dial-Session-Dialing-FAQ ; Nooks — auto-skip answering machines while power dialing [how it works: the skip rule mid-session] — https://support.nooks.ai/articles/6503054824-auto-skip-answering-machines-while-power-dialing ; Nooks — making one-off dials (breaking out of the queue) — https://support.nooks.ai/articles/7937491961-making-one-off-dials-with-nooks
- **Build docs:** Twilio Call resource — https://www.twilio.com/docs/voice/api/call-resource ; current-row highlight = doc 4b Journey 4b.8.

## Journey 3.4a — Work an account by dialing its people (no special "company dialer")

*As a rep, I want to call everyone at a target account, so that I work whole accounts — without a separate, complicated "company dialing" mode.*

**You were right — I've dropped the two-mode company dialer.** Writing the user story out makes the simplification obvious: **you never dial "a company" — you dial the people at it.** So there is no company-dialer. You make a **list or view of People** (filtered to the account, or to many accounts) and power-dial it exactly like any other list (Journey 3.4). This also removes the "primary-contact resolver" dependency entirely.

**Your composite-list question (company + person + activity on one list) — answered.** The call list stays a list of **People**, but it can be a **composite view**: a People-rooted **denormalized grid** (doc 4b Journey 4b.1 / `GridView`) that adds **company columns** (account name, industry, owner) pulled through the person→company reference, and a merged **Activity column** (calls/emails/texts, doc 4b combination cells). So the rep sees company + person + activity context **on one row while he dials the person** — no second object "on the list," no ambiguity about what a row means.

1. **Entry point.** He opens (or builds) a **People list/view** filtered to his target accounts — optionally a **composite view** with company + activity columns (doc 4b).
2. **Power dial it** (Journey 3.4). One call per person, top to bottom, in the list's order.
3. Account context (company, other contacts, recent activity) rides along in the columns and on the record (Journey 3.4b).

- **Benchmark (beat this):** Attio — composite/denormalized list views *(company + person + activity in one grid)* — https://attio.com/help/reference/attio-101/records-lists-and-views ; Nooks — enhanced prospect rows (the account context carried on each row) [how it works] — https://support.nooks.ai/articles/1995246243-enhanced-prospect-rows
- **Build docs:** reuses doc 4b composite grid (`GridView`, combination cells) + doc 4c lists/views + Journey 3.4. No company-dialer, no new model.

## Journey 3.4b — See "other people at this account" while I'm calling

*As a rep, I want the record I'm on to prominently show the other contacts at that account — with their titles and a link — so that when my target doesn't answer I can immediately try a colleague.*

1. **Where it shows.** On the **person, company, and deal** records, and on the **live-call screen** (doc 2), a **"People at {Company}"** panel is prominent (right rail on records; a strip on the call screen, extending doc 4a Journey 4a.8's pre-call context). Each colleague row: **name · title · a "Call" quick action · a link to their record.**
2. **The data.** This is the account's related people (doc 4a related records / doc 4 Journey 4.6 company→people) — no new model, just surfaced where the rep is calling.
3. **Calling a colleague** from this panel during a power-dial run is a **manual action** — it dials them now, and the queue resumes after (Journey 3.4d).

- **Benchmark (beat this):** Apollo — account/contacts overview *(the prominent "people at this account" panel we want)* — https://knowledge.apollo.io/hc/en-us/articles/4409140507277-Accounts-Overview ; Attio related records — https://attio.com/help/reference/attio-101/records-lists-and-views
- **Build docs:** reuses doc 4a related records + doc 2 live-call screen. Surface, don't rebuild.

## Journey 3.4c — Dial a person's primary number, or each number in sequence

*As a rep, I want to choose whether the dialer calls only the primary number or tries each of a person's numbers in turn, so that I can reach people who have several numbers.*

1. **The option.** In the power-dial popover (Journey 3.4), a toggle: **"On no answer, try the next number"** — **off** = primary number only (the default); **on** = try primary, then the next usable number by `position`, until someone connects or the numbers run out.
2. **How it resolves per person.** Dial the **primary** phone (`ContactPhone.isPrimary`, doc 3a Journey 3.14c). If on and the result is no-answer/failed, fall to the next number by `position`, **skipping DNC and unreachable numbers**. **Stop at the first connect.** We never blast every number in one pass (harassment).
3. **What he sees.** Each attempted number shows on the call row ("tried mobile → no answer → trying office").

- **Benchmark (beat this):** PhoneBurner — the dialing FAQ [how it works: when a contact has several numbers, it asks dial-next-number vs next-contact] — https://support.phoneburner.com/hc/en-us/articles/115004996246-How-do-I-start-a-Dial-Session-Dialing-FAQ ; PhoneBurner — set a contact's primary number — https://support.phoneburner.com/hc/en-us/articles/115005504463-How-do-I-change-the-primary-phone-number-for-a-contact-with-multiple-numbers ; PhoneBurner — avoid re-dialing the same number in a session — https://support.phoneburner.com/hc/en-us/articles/115005075006-How-Do-I-Avoid-Dialing-the-Same-Number-in-a-Dial-Session-
- **Build docs:** internal — a per-person number-resolver over `ContactPhone.position` in the Journey 3.4 loop.

## Journey 3.4d — Do manual things mid-session without losing my place

*As a rep, I want to dial someone else or do a manual task during a power-dial run and have the queue wait and pick up after, so that power dial helps me instead of locking me in.*

1. **The rule.** If, mid-session, he **manually dials** a number (a colleague from Journey 3.4b, or a number he types), the power-dial queue **auto-pauses**. His manual call runs like any call (talk, disposition).
2. **Resume.** When his manual call ends and he dispositions it, the app **resumes** the queue with the **next queued person** after the normal delay — i.e. the next queued dial is simply **queued behind whatever he just did.**
3. **What he sees.** The dialer widget shows **"Power dial paused — resumes after this call,"** with **Resume now** and **End session** buttons. His place in the list is never lost.

- **Benchmark (beat this):** PhoneBurner — finish or resume a dial session you already started [how it works: sessions survive, resumable for 60 days] — https://support.phoneburner.com/hc/en-us/articles/360000516743-How-do-I-finish-or-resume-a-Dial-Session-I-have-already-started ; Nooks — making one-off dials outside the queue — https://support.nooks.ai/articles/7937491961-making-one-off-dials-with-nooks . *(The "queue waits behind you" idea is our refinement — neither vendor documents it.)*
- **Build docs:** internal — the session queue treats a manual call as pause+insert, then continues.

---

## Decisions for you (this doc)

**1. Power-dial delay default?**
- **~3-second countdown, skippable (my pick).** A breath between calls; a Skip button jumps ahead.
- **No delay.** Fastest, but jarring.

**2. "Try the next number" default (Journey 3.4c)?**
- **Off — primary only (my pick).** Simpler and calmer; the rep turns on multi-number when he wants coverage.
- **On by default.** More connects, but more dials per person.

*(The old "which company-dialer mode ships first" decision is gone — there is no company dialer, per Journey 3.4a.)*

---

## Data model (Prisma) — additions in this doc

Extends the calling-core schema. The heavy dialer models (`ContactPhone`, `DncEntry`, SMS, etc.) live in **doc 3a**; analytics models in **doc 3b**. This file adds only what import + power dial need.

```prisma
model Call {
  // ...all prior fields (doc 1 / doc 2), plus:
  listId   String?  // added: which CRM list/view this dial came from (doc 4c)
}

// REMOVED (do not recreate): CallList, CallListEntry, CallListImport.
// A "call list" is a CRM list (doc 4c ListEntity / ListEntry). Manual dial order =
// ListEntry.position (doc 4c Journey 4.10). CSV import = the widget in Journey 3.1.
// A prospect's phone numbers are ContactPhone (doc 3a Journey 3.14c), NOT this.
```

The power-dial **session** is transient (who's next, the frozen order, paused/running) — held in memory / the client, not a table. Nothing about a session needs to survive a refresh except the CRM list itself, which already persists.

---

## Technology choices (this doc)

Builds on the calling-core stack (doc 1 / doc 2). New here:

- **CSV import — PapaParse in the browser, streaming above ~5,000 rows / ~2 MB.** Smaller files parse in one pass; bigger ones stream row-by-row so the tab never freezes. Our own column-map + E.164-normalize + dedupe pass is job **D1** (defined in doc 3a's background-jobs list, since the hygiene half runs there).

*(Durable-jobs / pg-boss, timezone, and the rest of the at-scale tech choices are stated once, in **doc 3a** — not repeated here.)*
