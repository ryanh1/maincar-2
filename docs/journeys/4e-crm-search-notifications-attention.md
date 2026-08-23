# Doc 4e — Search, Command Palette, Notifications & Attention

Part of the **CRM Data & Views** family (split from the old doc 4 so each part stays short):

- **[4 — Objects, Fields & Schema](4-crm-data-and-views.md)** — objects, fields, references, rules, history, standard objects.
- **[4a — Relations & Related Records](4a-crm-relations-and-related-records.md)** — the "show me the whole Acme picture" UX.
- **[4b — Grid View: Power Editing & Keyboard](4b-power-views-editing-and-keyboard.md)** — multi-object grid, Sheets-grade editing, column groups, keyboard.
- **[4f — Composite Cells](4f-crm-composite-cells.md)** — cells with several values/chips (date + disposition, stacked people).
- **[4g — AI Columns](4g-crm-ai-columns.md)** — columns whose cells run an AI instruction.
- **[4c — Tables, Views & Lists](4c-crm-tables-views-lists.md)** — Journeys 4.7–4.10.
- **[4d — Records, Notes, Tasks & Mentions](4d-crm-records-notes-tasks.md)** — Journeys 4.11, 4.13–4.15.
- **4e — Search, Command Palette, Notifications & Attention** *(this doc)* — global search + palette, full-text search, the notification inbox, attention status. **Journeys 4.12, 4.16, 4.17, 4.18.**

**Journey numbers are stable across the split** — 4.16 is still 4.16, just in this file. The engineering, schema, and decisions for this doc are at the **bottom** (Background jobs · Decisions · Data model · Technical decisions · **§B — Notifications engineering**).

---

## Journey 4.12 — Global search and the command palette

*As a rep, I want one keyboard shortcut that jumps me to any record or runs any action, so that I navigate the whole app without hunting through menus.*

1. **Two ways in:** press **`Cmd/Ctrl-K`** anywhere, or click the always-visible **search box in the top bar** ("Search or jump to… ⌘K"). `/` is a power-user alias.
2. It opens as a **center modal (~640px), anchored just above center**, over a ~40% scrim. Open animation: backdrop fade ~120ms, panel fade+scale (0.98→1.0) ~150ms ease-out; close ~100ms. Fast enough to feel instant.
3. **Empty state** shows **Recently viewed**, then **Favorites**. **As he types**, results are **grouped and labeled**: **Records** (by object — People, Companies, Deals…), then **Actions** (new record, add note, change status, go to a view/settings), then Recently viewed / Favorites. Each group caps at ~5 with "show more". *(Here "Actions" means "commands you can run" — the palette sense, distinct from the retired object name; see doc 4 Terminology.)*
4. **Keyboard:** input auto-focused; `↑/↓` move across rows (skipping headers), first row preselected so `Enter` always does the obvious thing; `Tab` (or `Cmd-K` again) opens a contextual action sub-menu on the highlighted record; `Esc` closes.
5. He can **favorite** a record, list, or view to pin it to the sidebar.

- **Benchmark (beat this):** Attio — navigating your workspace — https://attio.com/help/reference/productivity-collaborating/navigating-your-workspace ; Raycast — navigation — https://manual.raycast.com/navigation ; macOS Spotlight — https://www.macrumors.com/how-to/do-more-with-spotlight-in-macos-tahoe/
- **Build docs:** cmdk — command palette — https://github.com/pacocoursey/cmdk

## Journey 4.16 — The notification inbox and its settings

*As a rep, I want one place that tells me what needs my attention — a teammate mentioned me, a task is due, a backburner lead just resurfaced — and I want to control what interrupts me, so that I stay on top of my accounts without being spammed.*

**What this feature is, in one sentence.** The **inbox** is a single list, in the left navbar, of things that happened that you might care about — so you don't have to go hunting across records to notice them. (Note: today the app is single-user, so most notifications come from **the app itself** — a task reminder, a backburner lead resurfacing, an AI/automation result — rather than from teammates. The design below is built so it also works the day a team exists.)

### 4.16.1 — Read the inbox

1. **Open it.** The rep clicks **Inbox** in the left navbar. It carries a small **unread count badge** so he can see at a glance whether anything is waiting.
2. **Each item is one card.** A card shows **who or what caused it** (an avatar or a system icon), a **short sentence describing it**, a **link to the thing it's about**, and **when** it happened. Example sentences: "Your task 'Call Dana' is due today", "Acme resurfaced from backburner — they said re-evaluate in August", "Ana mentioned you on the Acme deal".
3. **Related items are combined into one card ("bundling"), so the inbox doesn't flood.** If the same thing gets ten small updates, the rep sees **one** card that says "Ana and 2 others commented on the Acme deal" instead of ten separate cards. This is the single most important thing that keeps the inbox readable; the exact bundling rules are in §B.
4. **Each card has quick actions:** **Open** (go to the record), **Mark read / unread**, **Archive** (file it away — it's dealt with), and **Snooze** (hide it now and have it come back later — e.g. "remind me tomorrow"). *This is the only place the word "snooze" is used; on tasks the equivalent action is "Reschedule" — see doc 4.14 to understand why they're kept separate.*

### 4.16.2 — Find things in the inbox (tabs, filters, and bulk actions — and what each is for)

1. **Tabs** are saved slices of the inbox so the rep can focus: **Inbox** (everything not archived), **Unread**, **Snoozed** (things set to come back later), **Archived** (things filed away).
2. **Filters** narrow the list further. He can filter by:
   - **Type** — *what kind of event it is*: a **mention** (someone tagged you), an **assignment** (a task was given to you), a **comment/reply**, or a **status change** (a field like a deal's stage moved). These are the categories used in settings too.
   - **Object** — only show notifications about People, or Deals, etc.
   - **Assignee** — *whose notifications to show.* This exists **for managers**: today you only see your own, but once a team exists a manager can look at "what's landing on Dana's plate". Single-user today, correct for teams later.
   - **Unread only.**
3. **Bulk actions** let the rep clear the inbox fast instead of one card at a time: **Mark all read** and **Archive all**. The purpose is simple — after a busy morning you can wipe the slate in one click rather than clicking 40 cards.
4. **Keyboard:** `u` toggles unread, `e` archives, `h` snoozes (Linear's model), so the rep can triage the whole inbox without the mouse.
5. **How the states relate:** *read* and *archived* are **separate** — reading something doesn't file it, and you can archive something unread. A **snoozed** item **auto-returns** to the inbox at its snooze time, or sooner if there's new activity on it.

### 4.16.3 — Choose which notifications reach you, and where ("channels")

*Purpose: decide, per kind of event, how loudly you want to be told.*

1. The rep opens **Settings → Notifications**. He sees a simple **grid: kinds of event down the side, delivery channels across the top.** He ticks which channels each kind uses.
2. **A "channel" is just a place a notification can be delivered:**
   - **In-app inbox** — the list in 4.16.1. **Always on** (this is the master record; you can't turn the inbox off, only quiet the noisier channels).
   - **Email**, **Push** (browser/mobile), and **Slack** (optional, later — the Slack integration itself is [doc 11a](11a-slack-integration.md)) — the interrupting channels you opt into.
3. **The "kinds of event" are grouped into a few categories** — deliberately **grouped, not one row per event type**, so the rep makes ~5 easy choices instead of 50 fiddly ones (this avoids "notification-settings fatigue"): **Mentions**, **Assignments** (tasks given to you), **Comments/replies**, **Status changes** (a tracked field moved), and **Team/broadcast** (announcements, later).
4. **Sensible defaults ship:** **Mentions** and **Assignments** go to **all channels** (they're high-signal — someone needs you). Comments and status changes default to the **inbox only** (available if you want them louder, quiet by default).

### 4.16.4 — Control *when* notifications reach you (timing and quiet hours)

*Purpose: the same event can interrupt you now, or wait for a digest — you choose.*

1. For each channel the rep picks a **timing**: **Immediate** (send as it happens), **Digest** (collect them and send once per hour, or once a day at a set time), or **Off** (that channel, silent).
2. **Quiet hours.** He sets a start/end time and a timezone (e.g. 6pm–8am). During quiet hours, **push and email are held** and rolled into the next digest, while the **in-app inbox keeps filling silently** — so nothing is lost, but nothing buzzes his phone at night.

### 4.16.5 — How bundling decides immediate vs. batched (the rule behind the calm inbox)

- **High-signal events are immediate and never bundled:** **mentions** and **assignments** — someone needs you now, so they arrive on their own.
- **Noisy events are batched:** **comments, status changes, and bulk edits** are collected on a short **sliding window (2–5 minutes, 30-minute cap)** and grouped by `recipient + type + object`, so "someone edited this deal 12 times" becomes one card. This is why a **bulk stage-change of 50 deals** shows up as a single "50 deals moved to Won" card instead of 50 buzzes — that's what "bulk" refers to in the settings and §B.

The architecture, batching internals, and edge cases (actor == recipient, source deleted, read-state races) are in **§B — Notifications engineering** at the bottom.

- **Benchmark (beat this):** Linear — notifications (inbox, snooze, keyboard triage) — https://linear.app/docs/notifications ; Google Docs — notification bundling — https://support.google.com/docs/answer/91588
- **Build docs:** Knock — batch/debounce function (pattern reference) — https://docs.knock.app/designing-workflows/batch-function

## Journey 4.17 — Full-text search (find the words inside calls, emails, and notes)

*As a rep, I want to search the words inside calls, emails, and notes, so that I can find every conversation where a topic came up — not just records by name.*

The command palette (Journey 4.12) finds *the account named Acme*. It does **not** find *the three calls where someone said "we're evaluating a competitor."* That body-text search is a real need (Gong's core value), so it gets **its own results page**.

**To be clear: "separate" means a separate *page*, not a separate *release* — this feature ships as part of this family, not later.** The command palette and this full-text search are two surfaces of the same release: the palette is a fast "jump to a record" box; this is a "search the words inside everything" page. Both are built now. The only thing framed as *later* is swapping the search **engine** from Postgres full-text to a dedicated service (Typesense/Meilisearch) if scale demands — an internal upgrade behind the same page, not a delay of the feature. The build path is job E2 (below).

1. He presses a shortcut (or hits Enter in the palette on a long query) → a **search results page**.
2. It searches **inside the bodies** of transcripts, emails, texts, and notes — not just record names — with **operators**: `"exact phrase"`, `+` (AND), `|` (OR), `-` (exclude).
3. **How the rep learns the operators, and casing.** He should never have to memorize syntax:
   - The **search box placeholder shows an example** ("Try: \"competitor\" +evaluating -churned").
   - A small **"?" / "Search tips"** affordance in the box opens a **cheatsheet popover** listing each operator with a one-line example — always one click away, so operators are discoverable, not hidden knowledge.
   - **Input is forgiving:** plain words with no operators just work (implicit AND); operators are an optional power layer.
   - **Casing:** search is **case-insensitive** — "Competitor" and "competitor" match the same, because Postgres full-text normalizes both text and query to lowercase lexemes (see §Search). The rep never has to match case.
4. Results are **grouped by type** — **Calls / Emails / Texts / Notes / Records** — each hit showing a **snippet with the match highlighted** and a link to the source moment (the transcript timestamp, the email, the note).
5. **"Ask AI instead" toggle.** The same search box offers a second mode that routes the question to the **AI Q&A** (doc 7.5) — natural-language question → a synthesized, cited answer — so keyword search and AI search sit side by side (Gong's "Ask Anything on the search page" placement). We already have the AI mode; this is just the entry point, not new AI work.

- **Benchmark (beat this) — split by aspect:**
  - **Gong — the core capability:** body/transcript search + operators, and AI "Ask Anything" beside it. Match or beat it on *what* we can find. — https://help.gong.io/docs/search-for-calls · https://help.gong.io/docs/understanding-ai-ask-anything
  - **Superhuman — *speed and the resolved-query feel*:** search should return as fast as you type and make operators feel effortless. Beat Gong on *how fast and how learnable* search feels.
  - **Atlassian (Confluence/Jira) — *discoverable advanced-search syntax*:** their search shows syntax help and a query cheatsheet inline. This is the model for the "?" tips popover in step 3 — beat Gong on *teaching the operators*. — https://support.atlassian.com/confluence-cloud/docs/what-is-advanced-search/
- **Build docs:** Postgres full-text (`tsvector` + GIN) over transcript/email/text/note bodies (job E2); a search service (Typesense/Meilisearch) later behind the same page; AI mode = doc 7.5.

## Journey 4.18 — Attention status + ownership on People and Companies

*As a rep, I want to mark whose a record is and where it sits in my attention, so that I always know who to work next and no important lead quietly rots.*

The rep needs to say, at a glance, **whose** a record is and **where it sits in his attention** — not just "lead / customer" but the finer working states you described.

1. **Ownership.** People and Companies carry an **owner** (a User) — who's working it. (Trivial single-user; it's what team visibility keys off later, doc 11.4.)
2. **Attention status — fewer primary states, with a "reason" for precision.** Five near-synonyms for "pushed back" is a lot to choose between mid-call, but we don't want to lose precision. Here is the analysis and the pick.

   **Options I considered:**
   - **(A) Keep all 5 flat labels.** Most precise, but highest mental load — the rep pauses to decide between "Parked" and "Cooled" every time. Rejected as the primary control.
   - **(B) Rename the labels to be clearer.** Helps a little, but 5 items is still 5 items.
   - **(C) Color-code with shades of one hue for "temperature".** Great as a *reinforcement* (warm = active, cool = pushed back), but color alone can't carry five distinct meanings accessibly.
   - **(D) Tooltips that define each state.** Good as a *safety net*, but you shouldn't need a tooltip to use the everyday control.
   - **(E) Fewer *primary* states + a separate *reason* tag.** Collapse the near-duplicates into one status, and capture *why* in a lightweight second field. Lowest mental load, and it **keeps every distinction you named** — just moves the fine detail out of the everyday pick.

   **Recommendation: (E), reinforced by (C) and (D).** The primary **Attention status** field drops to **four buckets that actually behave differently**:
   - **On deck** — not worked yet; front of the line.
   - **On hold** — deprioritized *for now*, will revisit. **This one absorbs both "Parked" and "Cooled"** — they were the same behavior (temporarily pushed back) differing only in *why*.
   - **Backburner** — pushed back with a **specific callback date** (behaves differently: it auto-returns — step 3).
   - **Disqualified** — pushed back long-term / near-DNC (can flow to the DNC list, doc 3.14a).

   Then a small, optional **"Reason"** field (a select with seeded options like *other stakeholder*, *cooled after call*, *timing*, plus free text) records the nuance — so "Parked because another stakeholder is primary" is now **On hold · reason: other stakeholder**, and nothing you described is lost. **Color** carries temperature as shades (On deck = warm green, On hold = amber, Backburner = blue, Disqualified = grey/red), and **tooltips** define each on hover as the safety net.

   **Why this is better:** the rep makes a **4-way choice he can hold in his head** (front / paused / timed / dead), the *reason* captures precision without cluttering the everyday pick, and color + tooltips make it self-explanatory. It's more scalable too — new nuances become new *reasons*, not new top-level statuses.

3. **The Backburner auto-return — does it actually work, and what else could.** When he sets **Backburner**, he sets a **callback date**; the intent is that the lead comes back to him at the right moment instead of rotting. The original design just flipped the status to On deck and dumped the lead into today's call list. That reaches the goal *sometimes*, but here are the ways it can miss, and the hardened design.

   **Ways the naive flip fails:**
   - **It resurfaces into a pile.** If the rep is buried that day, a silent status change lands in the middle of a long list and rots again — the exact problem we're solving.
   - **It disrupts the working list.** Silently injecting leads into "today's call list" reorders/bloats the list he's actively dialing.
   - **Bad timing.** A raw date trigger can fire on a weekend, at night, or in the wrong timezone.
   - **The lead moved on.** By the callback date the owner may have changed or the record been archived; a blind flip ignores that.
   - **Weak signal.** If the reason was vague, the nudge is easy to ignore.
   - **Silent failure.** If the trigger is a fire-and-forget status write and the job misses, nothing tells anyone.

   **Alternatives considered:** (a) a **dedicated "Resurfacing today" section** the rep opts into, rather than silent injection; (b) create a **Task** instead of only flipping status — the task engine already gives an assignee, a due date, dismiss/reschedule, and it shows in My Tasks; (c) a **notification-only** resurface (inbox card); (d) a **weekly digest** of what's due to come back.

   **Recommendation — keep the auto-return, but make it a Task + a visible section, and harden the timing.** On the callback date, a **workflow** (doc 10, trigger = "date field arrived", reusing the 7b.5 callback-reminder engine) does four things instead of one:
   1. **Creates a Task** — a **Reminder** (Journey 4.14) assigned to the owner: "Call Dana back — she said re-evaluate in August", carrying the **original reason and context**. A task is *active* (assigned, dismissible, reschedulable, tracked) where a bare status flip is *passive*.
   2. **Flips the status** On deck (so filters/reporting reflect it).
   3. **Surfaces it in a "Resurfacing today" section pinned at the top of the call list** — visible and opt-in-to-dial, **not** silently shuffled into the middle of the list he's working.
   4. **Sends a notification** (Journey 4.16) with the reason and urgency.
   Plus two guards: it **fires on the next business morning in the rep's timezone** (never weekends/nights), and if the task **isn't actioned in a few days it re-nudges** (so it can't silently rot again). If the owner changed or the record was archived, it routes to the new owner or skips with a flag rather than flipping blindly.

   **Why:** a Task is the piece that guarantees the lead is *acted on*, not just *relabeled*; the "Resurfacing today" section makes it visible without hijacking the active list; the timezone/business-day guard and the re-nudge close the "it came back at a bad moment and rotted" gap. This reuses engines we already have (tasks 4.14, notifications 4.16, workflows doc 10, callback reminders 7b.5) rather than inventing anything.

4. The status shows as a colored chip in the grid and on the record; he can filter/sort/group by it, by reason, and by owner (doc 4c 4.8 / 4b).

- **Benchmark (beat this):** Attio — status attributes ; Salesforce/HubSpot — lead status + owner fields — https://knowledge.hubspot.com/contacts/use-lifecycle-stages
- **Build docs:** internal — seeded `attentionStatus` (4 options), `attentionReason` (select + free text), `callbackDate`, and `ownerId` AttributeDefs (doc 4.6); the auto-return is a doc-10 workflow on a date trigger that creates a Task (4.14) + notification (4.16) + a "Resurfacing today" call-list section, fired on the next business morning in the rep's timezone.

---

## Background jobs (this doc)

- **E2 — Search index.** Keep global search fresh as records change: update the row's `tsvector` on write; near real-time. Powers Journey 4.17.
- **E3 — Notification fan-out + batch.** On a mention/assignment/activity, write a per-recipient inbox row; batch the low-priority kinds on a sliding window before delivering to email/push. (§B.) Powers Journey 4.16.

---

## Decisions (search & notifications)

**1. Command palette — Decided (you agreed): search + run any action** (Journey 4.12). One box both jumps to records and runs commands.

**2. Search engine — Postgres full-text now, a search service later.** `tsvector` + GIN ships the feature today (Journey 4.17); Typesense/Meilisearch is a drop-in behind the same page if scale demands, because search sits behind a service boundary.

---

## Data model (Prisma) — additions in this doc

Extends doc 4. **New models marked `// NEW`.** Uses the **notification-object model** (one object per event, one row per recipient).

```prisma
model NotificationObject {  // NEW — Journey 4.16 / §B (the event, stored once)
  id         String   @id @default(cuid())
  workspaceId String
  actorId    String            // who did it (suppressed if == recipient)
  verb       String            // mention | assignment | comment | status_change
  objectType String            // record | task | note | deal ...
  objectId   String
  snapshot   Json              // text snapshot so a deleted source still renders
  createdAt  DateTime @default(now())
}

model Notification {        // NEW — per-recipient state + batching (job E3)
  id         String   @id @default(cuid())
  userId     String
  batchKey   String            // recipient + verb + objectId (grouping key)
  objectIds  String[]          // NotificationObject ids folded into this bundle
  isRead     Boolean  @default(false)
  isArchived Boolean  @default(false)
  snoozedUntil DateTime?
  createdAt  DateTime @default(now())
  @@index([userId, isRead])
}
```

*(Full-text search adds a `tsvector` column + GIN index to the transcript/email/text/note tables — see Technical decisions → Search. Attention status/reason/callbackDate are seeded AttributeDefs on People/Companies — see doc 4's data model.)*

---

## Technical decisions, trade-offs & edge cases

**Search — what `tsvector` is (Journey 4.17 / E2).** Postgres full-text search turns a row's text into a **`tsvector`**: a normalized list of searchable *lexemes* (words reduced to roots — "calling"→"call") with their positions. A query is a **`tsquery`**; Postgres matches query against vector using a **GIN index**, which is what makes search fast without a separate service. **"Update the tsvector on write, expect near-real-time"** means: when a record changes, job E2 recomputes that row's `tsvector` (a cheap write), so search reflects the change within a moment — not instantly in the same transaction, but sub-second. Moving to Typesense/Meilisearch later is a drop-in because search already sits behind a service boundary. Case-insensitivity (Journey 4.17 step 3) falls out of this: both text and query are normalized to lowercase lexemes.

---

## §B — Notifications engineering (referenced from Journey 4.16)

**Architecture patterns we adopt** (each with why):
- **Notification-object model** — store the *event* once (`NotificationObject`: actor, verb, object), plus one lightweight `Notification` row per recipient carrying read/archived state. Lets us render "X and 3 others…" from one object and keep text correct if the source changes. ([data-model write-up](https://tannguyenit95.medium.com/designing-a-notification-system-1da83ca971bc))
- **Fan-out-on-write for the inbox** — write the per-recipient row at event time so the inbox read path is a single indexed query. Our audiences are tiny (single-user now), so write cost is nothing. ([SuprSend](https://www.suprsend.com/post/notification-microservice-architecture))
- **Event → per-channel workers** — one event routes to independent in-app / email / push workers, each with its own retry. ([SuprSend](https://www.suprsend.com/post/notification-microservice-architecture))
- **Debounce + batch on a sliding window keyed by `recipient + verb + object`** — open a window on first trigger (2–5 min, 30-min cap), fold later activities in, send once. ([Knock batch](https://docs.knock.app/designing-workflows/batch-function))
- **Dedupe on a deterministic key** — collapse repeat triggers of the same (actor, verb, object) into one.
- **Digest for low-priority** — roll unread items into an hourly/daily email, and only send if still unread. ([Linear](https://linear.app/docs/notifications))

**Edge cases + handling:**
- **Actor == recipient** → suppress at write time (never notify your own action).
- **Mention + assignment in one action** → dedupe to the higher-priority single (assignment wins, mention folded in).
- **Many triggers from one action** (bulk stage-change of 50) → debounce + dedupe → one bundled item ("50 deals moved to Won").
- **Comment thread blows up** → grouping key aggregates actors ("Ana, Sam +6 commented").
- **High-volume storms** → per-recipient rate cap; overflow forced into digest; sliding-window cap prevents runaway.
- **Source deleted after the notification** → render from the stored `snapshot`, mark "no longer available," auto-archive if hard-deleted.
- **Permission loss** → check ACL at delivery time; suppress if the recipient can no longer see the object (matters once roles land).
- **Read-state race** (read on web, bold on mobile) → server-authoritative read state, last-write-wins, push seen/read to other sessions.

- Sources: [Knock batch/debounce](https://docs.knock.app/designing-workflows/batch-function) · [Linear notifications](https://linear.app/docs/notifications) · [Google Docs bundling](https://support.google.com/docs/answer/91588) · [SuprSend architecture](https://www.suprsend.com/post/notification-microservice-architecture) · [notification data model](https://tannguyenit95.medium.com/designing-a-notification-system-1da83ca971bc)
