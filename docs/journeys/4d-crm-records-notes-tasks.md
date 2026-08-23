# Doc 4d — Records, Notes, Tasks & Mentions

Part of the **CRM Data & Views** family (split from the old doc 4 so each part stays short):

- **[4 — Objects, Fields & Schema](4-crm-data-and-views.md)** — objects, fields, references, rules, history, standard objects.
- **[4a — Relations & Related Records](4a-crm-relations-and-related-records.md)** — the "show me the whole Acme picture" UX.
- **[4b — Grid View: Power Editing & Keyboard](4b-power-views-editing-and-keyboard.md)** — multi-object grid, Sheets-grade editing, column groups, keyboard.
- **[4f — Composite Cells](4f-crm-composite-cells.md)** — cells with several values/chips (date + disposition, stacked people).
- **[4g — AI Columns](4g-crm-ai-columns.md)** — columns whose cells run an AI instruction.
- **[4c — Tables, Views & Lists](4c-crm-tables-views-lists.md)** — Journeys 4.7–4.10.
- **4d — Records, Notes, Tasks & Mentions** *(this doc)* — the record page/drawer, notes, tasks, @mentions. **Journeys 4.11, 4.13, 4.14, 4.15.**
- **[4e — Search, Notifications & Attention](4e-crm-search-notifications-attention.md)** — Journeys 4.12, 4.16–4.18.

**Journey numbers are stable across the split** — 4.11 is still 4.11, just in this file. The engineering, schema, and decisions for this doc are at the **bottom** (Background jobs · Decisions · Data model · Technical decisions).

---

## Journey 4.11 — Open a record's detail page

*As a rep working call to call, I want to open a record in a fast peek drawer and step through records by keyboard, so that I can see everything about a person without losing my place in the list.*

1. From any table, he clicks a row. A record **drawer** slides in **from the right**, ~520px wide. It **overlaps** the table under a light scrim (it does **not** push the table over) — so the list keeps its scroll position and nothing reflows, which matters when he is flicking record to record. `Esc` or click-out closes it instantly.
   - **"Can't I see or use the table while the drawer is open?" — and why that's fine.** The drawer covers the **right ~520px**; the **left portion of the table stays visible** underneath the scrim for context. More importantly, **he navigates records without the table: pressing `j` / `k` (or ↑/↓) moves to the next/previous row in the underlying view and the drawer updates in place** — so flicking through 30 records is a keyboard flow, not a click-hidden-row flow. He is not meant to click table rows while the drawer is open; he is meant to arrow through them. This is the Superhuman/Attio peek model, and it is exactly what a rep working a list wants. If he *does* want the full table back, one `Esc` closes the drawer instantly.
   - **Animations — extremely snappy.** Open: slide-in from the right **~160ms, ease-out**; scrim fades **~120ms**. Close: **~120ms**. Critically, **moving record-to-record with `j`/`k` does NOT replay the slide** — the drawer stays put and its **contents cross-fade ~80ms**, so stepping through records feels instant, like paging through Superhuman's inbox, not like a panel re-opening each time. Nothing here should ever feel like a wait; if a transition reads as slow, it is a bug. (Prefetch of the next record's data, doc 4a Technical decisions, is what makes the cross-fade show real content immediately.)
2. **Inside the drawer:** the record's **fields** are the top/primary block; below them a compact **Associations rail** (Company, People, Deals, recent Calls — each one click to open); and a **chronological activity timeline**. **The timeline, specified:**
   - **Layout.** It is a **single vertical column, newest at the top**, with **day separators** ("Today", "Yesterday", "Aug 12"). Each entry is a compact row: a **type icon** on the left, then a one-line **title/summary**, the **actor** (avatar), and a **relative timestamp** on the right. Long entries show a 2-line preview with **"See more"** that expands in place (doc 4a Journey 4a.6).
   - **Entry types and what each shows:**
     - **Call** ☎ — direction, **disposition**, duration, and a summary snippet; links to the recording/transcript (doc 2).
     - **Email** ✉ — direction, subject, and a body snippet.
     - **Text (SMS)** 💬 — direction and the message text.
     - **Meeting** 📅 — title, time, and attendees.
     - **Note** 📝 — a note *is* activity, so it renders as an entry with its author and a body preview (read-only HTML; click to edit, Journey 4.13).
     - **Task** ✓ — an entry when a task is **created, completed, or comes due**, showing its title, due date, and commitment (Journey 4.14). So a rep sees "Task created: send proposal" and later "Task completed" inline.
     - **Field change** ⟳ — a compact `old → new` (from the field-history log, doc 4.5), e.g. "Stage: Demo → Won".
   - **Custom objects & custom events on the timeline.** Any **related record** the admin has opted into the timeline shows up as an entry — including **custom objects** (a "Partner intro" record) — using a generic entry shape (icon · title · timestamp · link). The admin picks **per object** which related kinds feed the timeline (doc 4a Journey 4a.9), so a custom "Site Visit" object can post to the person's timeline without us pre-baking it. The generic renderer means new object kinds need no new timeline code.
   - **Filter the timeline** by type (Calls / Emails / Texts / Notes / Tasks / Meetings / Changes) and, on a company, by **contact** and **deal** (doc 4a).
3. An **"expand to full page"** control turns the peek into the canonical full record page (three-region layout: fields, activity, associations).
4. **Responsive:** ≥1280px, drawer over a visible table; 1024–1280px, the table auto-narrows; <1024px/mobile, the drawer becomes **full-screen** with a Back button (never a cramped half-panel).
5. He can export the current view to CSV.

*The associations rail, the cross-contact "Acme activity" feed, note truncation, the cross-user / multi-deal cases, and the sub-100ms prefetch approach are specified in **[4a-crm-relations-and-related-records.md](4a-crm-relations-and-related-records.md)** — this is the most important UX in the CRM.*

- **Benchmark (beat this):** Attio — configure record pages — https://attio.com/help/reference/managing-your-data/records/configure-record-pages ; HubSpot — record page layout — https://knowledge.hubspot.com/records/work-with-records
- **Build docs:** internal — see the relations doc (4a) and the DetailLayout config (doc 4b.11).

## Journey 4.11a — Duplicate a record (clone a company)

*As a rep, I want to duplicate an existing record, so that I can create a near-identical one (e.g. a second branch of the same company, or a similar deal) without re-typing everything.*

Cloning is a first-class CRUD-adjacent action on **any object** (the running example: a Company with two branches). It copies the record's **fields**, not its history or activity.

1. **Entry points (two).** **(a)** On the record page/drawer (Journey 4.11), the **⋯ actions menu** → **Duplicate**. **(b)** In a table, **right-click a row → Duplicate** (the grid row context menu, doc 4b). Both land on the same flow.
2. **A "Duplicate record" dialog opens** showing what will be copied, so it's never a blind clone:
   - **Fields:** all normal field values are copied. The **name** gets a **" (copy)"** suffix by default (editable in the dialog), so the clone is distinguishable at a glance.
   - **References/relations:** **reference fields are copied** (the clone points at the same Company/Owner/parent, etc.). **Child/owned records are NOT copied** — the clone starts with **no calls, emails, notes, tasks, or activity** of its own (those belong to the original event history). A short line states this: *"Copies fields and links. Does not copy activity, calls, or notes."*
   - **Unique / contact-channel fields are cleared and flagged**, not blindly copied — **email and phone** are blanked with a hint *"Cleared to avoid a duplicate contact — add the new branch's number"* (copying them would create a real duplicate and misfire dedupe, design-principles §III / doc 5a). He can type the new values right in the dialog.
3. He adjusts anything, then clicks **Create duplicate**. **Background job:** insert one new record with the copied field JSON (unique fields normalized/empty-as-absent per doc 4); provenance/source marked `duplicated_from: <id>` for traceability. Optimistic — the new record opens in the drawer immediately, ready to edit.
4. **Bulk duplicate (optional).** From the selection bulk-action bar (doc 4c Journey 4.10), **Duplicate** on multiple selected rows clones each with the same rules (name + " (copy)", channels cleared). Guard-confirmed with a count for large selections.

**Defensive points.** Never silently duplicate an email/phone (dedupe would immediately flag it — so we clear + prompt). The clone is a brand-new record with its own id and empty activity — we never deep-copy an event history. `duplicated_from` gives an audit trail. Archived/standard-field rules from doc 4 still apply (a standard required field must still be present on the clone).

- **Benchmark (beat this):** **Salesforce — "Clone" a record** (clone with related-list choices) — https://help.salesforce.com/s/articleView?id=sf.faq_records_clone.htm ; **Airtable — duplicate a record** (row → Duplicate) — https://support.airtable.com/docs/duplicating-a-row-of-records-in-airtable ; **Attio** record actions for the ⋯-menu placement.
- **Build docs:** copy the record's field JSON, blank unique/contact-channel fields, keep reference fields, set `duplicated_from`; reuse the create path (doc 4 Journey 4.1) so validation/normalization runs on the clone.

## Journey 4.13 — Write a note

*As a rep, I want to jot a quick note on a record and @mention people or records, so that I capture what happened and link it without opening a document editor.*

A note is a **quick, one-off thought** on a record ("left VM, call back Tue," "@Sarah owns renewal"). It is a comment, not a document — so the editor stays deliberately minimal. Chosen after comparing Linear, Attio, Slack, Jira, Airtable (Linear + Attio are the models).

1. On any record he clicks **Add note** (or presses a shortcut). The field starts one line tall and **grows as he types**.
2. **Formatting (IN):** **bold**, *italic* (markdown shortcuts `**`, `*`, plus a selection-bubble toolbar on highlight); **bullet & numbered lists** (`- `, `1. `); **links** (auto-detect URLs); **`@mentions`** of people *and* records (Journey 4.15) — the one non-negotiable rich feature, because it drives linking + notifications; inline `code` (optional).
3. **Formatting (OUT):** headings, underline, images/embeds, tables, callouts, and any always-on toolbar. (For files, attach them to the record instead.)
4. **CRUD:** he can edit his own note; delete is a real delete (a note is its own record, not a field on the record) with an undo toast. Notes are timestamped and attributed.
5. **Attach one note to several records (many-to-many).** A note is its own record, so it can link to **more than one** person/company/deal at once — e.g. a call note about two people on the same call, or a meeting note that belongs to the deal *and* both attendees. He adds links from the note ("Also on: …"); each linked record shows the note in its activity feed. (Same link pattern as tasks — the `NoteLink` join model and the full "which relations are 1-to-many vs many-to-many" guide live in **[4b — Technical decisions](4b-power-views-editing-and-keyboard.md)**.)
6. **In the activity feed, notes render as read-only HTML** (cheap); a real editor mounts only when he clicks to edit one — so a feed of 50 notes stays fast.

*Editor library choice (TipTap) and the "many editors on one page" performance rule are in Technical decisions at the bottom.*

- **Benchmark (beat this):** Linear — editor — https://linear.app/docs/editor ; Attio — comments & mentions — https://attio.com/help/reference/productivity-collaborating/comments-and-mentions
- **Build docs:** TipTap — mention extension — https://tiptap.dev/docs/editor/extensions/nodes/mention ; TipTap — render as HTML (`generateHTML`) — https://tiptap.dev/docs/editor/api/utilities/html

## Journey 4.14 — Create and manage tasks

*As a rep, I want to create and track follow-up tasks with due dates and clear commitment levels, so that I never drop a promised callback or a self-reminder.*

Chosen after comparing Attio, HubSpot, Salesforce. Tasks are **action items**; calendar events (Meetings) are separate but linkable.

1. **Create anywhere:** a global shortcut, the record page (auto-links that record), or a list.
1a. **Natural-language due dates — what that means and how it works.** When the rep types the due date he can write **plain words** — "next Tuesday", "in 3 days", "friday 1pm", "end of month" — and the app **converts that text into a real date/time value** and stores the actual datetime (not the words). As he types, a small preview shows the **resolved date** it parsed ("→ Tue Aug 25, 1:00 PM") so he can confirm before committing; if it can't parse, the field stays empty and he picks from the date picker instead.
   - **How (open-source, no cost):** parsing is done with **chrono-node** (MIT, the standard JS natural-language date library — already chosen for the `@date` picker in doc 4b.7). It runs client-side, so the preview is instant.
   - **Benchmark:** **Superhuman**'s "Remind me" / snooze date input is the feel to match — you type words, it shows the resolved time, you hit enter.
2. **Fields (kept tight):** Assignee · Due date (date + optional time) · **Type** (Call / Email / To-do, admin-editable) · **Priority** (Low / Med / High) · **Commitment** (see below) · **Linked records** (may link several — e.g. a person + their deal).
2a. **Commitment — "Appointment" vs "Reminder".** A task carries a **commitment type** so the rep can tell two very different things apart: a timed thing the **prospect is expecting** him at, versus a **note-to-self** that can slip.
   - **User-facing labels: "Appointment" and "Reminder"** (chosen over "Hard/Soft" — opaque — and "Committed/Self-reminder" — wordy). Both words are instantly understood, map to how reps talk, and "Appointment" cues the calendar pairing (point 5). Internal value stays `hard`/`soft`.
   - **The control:** a **single two-option toggle** on the task — **Appointment** (they're expecting me) / **Reminder** (just for me). Default = **Reminder** (most tasks are self-reminders); flipping to Appointment reveals the exact-time field and offers to create the linked calendar event.
   - **What each means:** **Appointment** = the prospect agreed to a time and is waiting ("demo Thu 2pm"); appointment-grade, protected from silently slipping, usually paired with a calendar event. **Reminder** = approximate, may slip ("try Acme again this week"), never implies anyone is waiting.
   - **How the two look different in a list.** The **row renders differently** (not a separate window). An **Appointment** shows an **exact time**, a **filled marker**, and a "they're expecting you" cue; a **Reminder** shows a **looser due date**, a **hollow marker**, and no expectation cue:
     ```
     ●  Demo call — Dana (Acme)      Appointment · Thu 2:00 PM · they're expecting you
     ○  Try Acme again               Reminder · this week
     ```
     (Filled dot + exact time = someone is waiting; hollow dot + loose date = just for you.) The AI/warnings treat a **missed Appointment** as serious and a **slipped Reminder** as normal. This is the distinction PhoneBurner/Salesforce blur by making every follow-up one flat "task".
3. **Tasks is a first-class object; "My Tasks" is a saved view on it.** Like every other object, **Tasks has a navbar link and a table** (doc 4.6) — click it to see, sort, filter, and group **all** tasks in the workspace, the same grid as People or Deals. **"My Tasks" is not a separate page — it is the *default saved view* on that Tasks object** (Journey 4.9, doc 4c): pre-filtered to *my open tasks*, sorted overdue → today → upcoming, grouped by due date. So the navbar object = the whole table; "My Tasks" = one view of it (and a rep can make other views: "Team overdue", "This week's appointments"). **Filters** on any view: due date, assignee, status, type, priority, commitment, linked object. An **assignee filter** lets a manager view another rep's or the whole team's tasks (permission-respecting). The richer list layout of this view (grouping, keyboard actions) is doc 4b.9.
4. **The task actions — Complete, Reschedule, Dismiss-reminder.** Three plain, distinct actions:
   - **Complete** — the main action; checkbox → grayed, timestamped, `doneAt` set.
   - **Reschedule** — **change the due date** to a new date/time (quick options **Tomorrow / Next week / Custom**, or type a natural-language date). This is the *only* thing that moves a task in time. We dropped the words "snooze" and "defer" on tasks: "defer" was vague, and "snooze" belongs to *notifications*, not tasks. **Reschedule** says exactly what it does.
   - **Dismiss reminder** — clears **only the reminder notification** for this task; it does **not** change the due date or complete the task. (No "dismissed" task status — the task still exists and is still due.)
   - **Note on "snooze":** the word **snooze survives only in the Notification inbox** (doc 4.16), where it means "hide this notification and bring it back later" — a different surface and a different thing. Keeping "snooze" off tasks removes the dual-model confusion. (Doc 4b.9's list actions match: the fast key reschedules; it does not "snooze" the task.)
4a. **Edit and delete a task.** **Edit:** every field is **inline-editable** wherever the task shows — click the assignee, due date, type, priority, commitment, title, or links and change it in place (same gesture as record fields, doc 4b.11); no modal, no "Save". **Delete:** a task **can be deleted** — a task created by mistake should be removable — via a ⋯ menu with an **undo toast**. But **Complete is the intended end state** for a real task (it preserves the history that a follow-up happened); delete is for genuine mistakes, not for finishing work.
5. **Task ↔ calendar:** a "reminder about an upcoming meeting" is a **task linked to the calendar event** (a Meeting, doc 4.6), not a duplicate event — the task carries the action ("prep deck"), the event owns the time slot. A task may also carry an optional reminder time that fires a **dismissible** notification (step 4).

- **Benchmark (beat this):** Attio — tasks — https://attio.com/help/reference/attio-101/productivity/introduction-to-tasks ; HubSpot — tasks — https://knowledge.hubspot.com/tasks/create-tasks
- **Build docs:** internal — see the data model below.

## Journey 4.15 — @mention someone or a record

*As a rep, I want to @mention a teammate, a contact, or a record while typing a note, so that I link the right thing and notify the right person without leaving the editor.*

1. **Typing `@` opens the picker.** In any note, comment, or field, typing **`@`** opens a **popup list under the caret** that filters as he types. It is **grouped by kind with section headers**, so the three kinds are visually separated:
   - **Teammates** (internal Users) — header "People on your team", each row = **avatar + name + role**, with a subtle **"teammate" accent** (these are the only mentions that *notify a human*).
   - **Contacts** (CRM People) — header "Contacts", row = avatar + name + company.
   - **Records** (Companies, Deals, and other objects) — header per object ("Companies", "Deals"), row = object icon + name + a bit of context (domain, amount).
   Each row carries its **object-kind icon** so even scanning fast, a Deal never looks like a teammate. Typing narrows all groups at once; `↑/↓` moves across rows, `Enter` picks.
2. He picks one → a **chip** is inserted (shows name/avatar + kind icon; click navigates to that person/record).
3. **On save, the mention is resolved server-side to a stable id** (user id or record id), not the display text — so a renamed person keeps the link, and the chip can't be spoofed by typing text. (Client shows the chip optimistically; the server is the source of truth.)
4. A mention of a **teammate (User)** creates a notification for them (doc 4.16); a mention of a **contact or a record** just **links** it (no notification — nobody is "pinged" by linking a company). This is the key behavioral reason the picker separates teammates from everything else.

**Editor library — TipTap, not react-mentions; and it costs us nothing.**
- **Use TipTap's Mention extension, not `react-mentions`.** We already use **TipTap** for the note editor (Journey 4.13), so mentions are the TipTap **Mention node** for one consistent editor across the app. `react-mentions` is a separate, lighter textarea-based library — bolting it on would mean two mention systems and two rendering paths. One editor, one mention grammar (the same `@`/`/` grammar as doc 4b.7).
- **TipTap is free and open-source.** TipTap's editor core and its extensions, **including Mention, are MIT-licensed and on GitHub** — free to use, no per-seat or subscription cost. The paid plans at tiptap.dev/pricing are for **TipTap Cloud** (their hosted real-time-collaboration backend, Content AI, comments service, etc.) — **backend services we don't need and won't buy**. We take the open-source editor libraries and run our own backend. So: **no editor subscription.**

- **Benchmark (beat this) — split by aspect:** **Notion** — the multi-type `@` menu (people / pages / dates in one grouped picker) — https://www.notion.com/help/comments-mentions-and-reminders ; **Linear** — mention speed + issue/person mentions — https://linear.app/docs/editor ; **Slack** — the people-mention feel + "notifies a human" model ; **Attio** — mentioning CRM records vs teammates — https://attio.com/help/reference/productivity-collaborating/comments-and-mentions
- **Build docs:** TipTap — mention extension (MIT) — https://tiptap.dev/docs/editor/extensions/nodes/mention ; the server-side mention resolver (step 3).

---

## Background jobs (this doc)

- **E5 — Activity fan-out (shared with doc 4a).** On every note/task write (and call/email/text/meeting/field-change), append a row to the denormalized **company activity feed** so a record opens sub-100ms and the timeline (Journey 4.11) reads as one indexed query. Trigger: on write of any timeline-eligible record. (Full spec in doc 4a — Background jobs.)

No other new background jobs — notes, tasks, and mentions are mostly synchronous writes plus the notification fan-out (E3, doc 4e) when a teammate is mentioned or assigned.

---

## Decisions (records, notes & tasks)

**1. Record page layout — you want options.** I can't embed live screenshots, so each option has a benchmark link + an ASCII sketch. I considered **three** (not two), because a pure sidebar and a pure 3-column are different enough to matter:

- **Option A — Attio-style: fields in a side panel, activity in the main area.** ([Attio record pages](https://attio.com/help/reference/managing-your-data/records/configure-record-pages))
  ```
  ┌───────────┬─────────────────────────────┐
  │  FIELDS   │  ACTIVITY TIMELINE          │
  │  (right   │  (notes, calls, emails,     │
  │  drawer   │   field changes, newest ↑)  │
  │  or left) │                             │
  │  ─────    │                             │
  │  ASSOC.   │                             │
  │  rail     │                             │
  └───────────┴─────────────────────────────┘
  ```
- **Option B — HubSpot-style 3-column: properties left, activity middle, associations right.** ([HubSpot layout](https://knowledge.hubspot.com/records/work-with-records))
  ```
  ┌────────┬──────────────────┬────────────┐
  │ FIELDS │ ACTIVITY         │ ASSOCIATED │
  │ (left) │ (middle)         │ records    │
  │        │                  │ (right)    │
  └────────┴──────────────────┴────────────┘
  ```
- **Option C — Peek drawer (fast) that expands to A.** A right-side drawer for the quick peek during call-to-call work; "expand" opens the full Option-A page.
  ```
  table…            ┌───────── drawer ─────────┐
  row  row  row     │ FIELDS                    │
  row [row] ────────│ ASSOC. rail (1-click)     │
  row  row          │ ACTIVITY (truncated)      │
                    └───────────────────────────┘
  ```
  **My pick: C (drawer) backed by A (full page).** It gives the sub-100ms peek the rep needs between calls, and the full page when he wants to dig in. B's three columns get cramped in a drawer and on laptops. **Tell me if you'd rather commit to B.**

---

## Data model (Prisma) — additions in this doc

Extends doc 4. **New models marked `// NEW`.**

```prisma
model Note {               // NEW — Journey 4.13 (TipTap JSON; own record, deletable)
  id          String   @id @default(cuid())
  workspaceId String
  recordId    String?      // the primary record it's attached to
  bodyJson    Json         // TipTap doc
  mentions    String[]     // resolved user/record ids (Journey 4.15)
  authorId    String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
// (Note ↔ record MANY-TO-MANY links are the NoteLink join model — doc 4b.)

model Mention {            // NEW — Journey 4.15 (one row per RESOLVED mention)
  id          String   @id @default(cuid())
  workspaceId String
  noteId      String
  targetType  String   // user | record — only "user" notifies a human
  targetId    String   // the stable id the server resolved, never the typed text
  @@unique([noteId, targetType, targetId])
  @@index([workspaceId, targetType, targetId])
}
// The body already carries the mention nodes. This table is redundant on purpose:
// back-links ("everything that mentions Acme") and the notification fan-out become
// indexed queries instead of a scan over every note's JSON.

model Task {               // NEW — Journey 4.14 (the Tasks object; formerly "Actions")
  id          String    @id @default(cuid())
  workspaceId String
  title       String
  type        String    @default("todo") // call | email | todo (admin-editable)
  priority    String    @default("med")  // low | med | high
  commitment  String    @default("soft") // internal: hard|soft. User-facing labels = "Appointment" (hard) | "Reminder" (soft) — Journey 4.14.2a
  assigneeId  String?
  dueAt       DateTime?
  remindAt    DateTime?  // optional reminder notification
  eventId     String?    // linked calendar event / Meeting (doc 5), not a duplicate event
  isDone      Boolean   @default(false)
  doneAt      DateTime?
  links       TaskLink[] // may link several records
}

model TaskLink {           // NEW — a task ↔ record link (person/company/deal/call)
  id       String @id @default(cuid())
  taskId   String
  objectId String   // which object kind
  recordId String   // the target (record id or a system-table id)
  @@index([recordId])
}
```

---

## Technical decisions, trade-offs & edge cases

**Notes editor — TipTap** (ProseMirror, MIT). Smallest tree-shakable bundle of the capable options; load only bold/italic/list/link/mention. **The many-editors-on-a-page problem (your Plate.js pain) is solved architecturally:** render feed notes as static HTML via `generateHTML()` and mount a live editor only on click-to-edit (one at a time) — so N notes ≠ N editors. (Plate.js/Lexical rejected on weight; ProseMirror-direct wins on raw bytes but costs more to build.)

**Mentions resolve to ids, not text (Journey 4.15).** The client inserts a chip optimistically, but on save the server resolves each `@` to a stable user/record id and stores that in `Note.mentions`. A rename never breaks the link, and text can't spoof a mention.

**Tasks vs. Activities.** A **Task** (this doc) is future-tense and lives in the `Task` table. A logged **Activity** (Call/Email/Text/Meeting) is past-tense and lives in its own table (docs 2/3/5). Both surface on the record timeline (Journey 4.11) via the activity fan-out (E5), but they are distinct models — the terminology fix from doc 4's *Terminology: two axes*.
