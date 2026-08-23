# Doc 4a — Related Records & Company Activity

Part of the **CRM Data & Views** family (head: [4 — Objects, Fields & Schema](4-crm-data-and-views.md); tables/views in [4c](4c-crm-tables-views-lists.md), records/notes/tasks in [4d](4d-crm-records-notes-tasks.md), search/notifications in [4e](4e-crm-search-notifications-attention.md), power layer in [4b](4b-power-views-editing-and-keyboard.md)).

**What this doc covers.** When a rep opens **one person's record**, he needs to see, without leaving it: that person's **company, deals, and recent calls**, and — the important part — **what everyone at that company has been doing** (calls, emails, notes), not just this one person. This doc is the step-by-step journeys for all of that.

**Why it matters.** A rep calls all day. Before he dials Dana at Acme, he wants to know that a teammate called her colleague Omar three days ago and left a note — so he doesn't repeat it and can open with real context. That "see the whole account on one record, instantly" is this doc.

---

## What's on a record (so the journeys below make sense)

Open any record (doc 4d Journey 4.11) and it looks like this. The **Related rail** and the **Activity feed** are what this doc adds:

```
┌──────────────────────────── Dana Reeve ──────────────────────────┐
│ FIELDS                                                            │
│   Title: VP Sales    Company: Acme    Phone: (415) 555-2671       │
│──────────────────────────────────────────────────────────────────│
│ RELATED   (the "associations rail")                               │
│   🏢 Acme Inc                          → click opens the company  │
│   💼 Acme Renewal · $40k               → click opens the deal     │
│   ☎  3 recent calls                    → click opens a call       │
│──────────────────────────────────────────────────────────────────│
│ ACTIVITY   [ This contact ▾ ] [ Everyone's ▾ ] [ All deals ▾ ]    │
│   Aug 14 · Call · Connected · by Sarah · Acme Renewal             │
│   Aug 12 · Email · Reply · by me                                  │
│   Aug 09 · Note · "left vm, call back Tue…"  See more             │
└──────────────────────────────────────────────────────────────────┘
```

- **Related rail** = the records linked to this one (company, deals, calls). Journey 4a.1.
- **Activity feed** = a time-ordered list of what happened. Its three dropdowns control **whose** activity it shows: **scope** (this contact vs everyone at the company — 4a.2), **owner** (everyone's vs mine — 4a.4), and **deal** (4a.5).

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the page that tells the coding agent how to build it. Engineering, the data model, and the "how do we make it instant" decision are at the **bottom**.

---

## Journey 4a.1 — See a record's linked records (the Related rail)

*As a rep, I want a person's company, deals, and recent calls listed right on their record, so that I can jump to any of them in one click before I dial.*

**What the "Related rail" is, plainly (you asked).** It's a small panel on the record that **lists the other records this one is linked to** — think of it as the record's "connections" box. On a Person it shows her Company, her Deals, and her recent Calls; each is a clickable row that opens that record. It's the exact same idea as **HubSpot's "Associations" cards** and **Salesforce's "Related" tab / lists** on a record — a compact index of everything attached to this record so the rep can jump straight to it. (See the ASCII at the top of this doc for the layout.)

1. The rep clicks a person's row in a table. Her record opens in the drawer (doc 4d Journey 4.11).
2. Directly **below her fields** he sees the **Related rail** — a short, labeled list: her **Company**, her **Deals**, her **recent Calls**. Each row is an icon + a name + one status chip.
3. He **clicks the Company row** → the company record opens in the drawer.
4. He **clicks a Deal row** → that deal opens. Every related record is **one click away**; he never searches for it.
5. The rail sits above the activity feed, so he sees it without scrolling.

- **Benchmark (beat this):** HubSpot — **association cards** on a record (the clearest "linked records" panel to match) — https://knowledge.hubspot.com/records/view-associated-records ; Attio — record pages with one-click relationships — https://attio.com/help/reference/managing-your-data/records/configure-record-pages ; Salesforce — Related lists on a record — https://help.salesforce.com/s/articleView?id=sf.records_related_lists.htm
- **Build docs:** internal — the rail reads the record's reference fields (doc 4.3) + the `CompanyActivity` counts (below).

## Journey 4a.2 — See the whole company's activity on a person's record

*As a rep, I want to widen the activity feed from "just this person" to "everyone at this company," so that I know what my teammates and I have already done at the account before I call.*

1. On Dana's record, the **Activity feed** starts scoped to **This contact** — it lists Dana's own calls, emails, texts, meetings, notes, and tasks, newest first (the record timeline from doc 4d 4.11.2).
2. He clicks the **scope dropdown** (top-left of the feed) and picks **Everyone at Acme**.
3. The feed now shows activity from **every person at Acme**, still newest-first. **Each row gains a contact badge** so he knows who it was with — e.g. "Aug 12 · Call · **Omar** · by Sarah."
4. **What he reads:** "Omar was called 3 days ago by Sarah — here's her note," so he opens Dana's call already knowing the account's recent history.

**What each entry looks like, per object type (your ask).** Every entry follows one consistent shape — **`[icon] [relative date] · [Type] · [key detail] · with [contact] · by [user avatar]`** — modeled on HubSpot's timeline (icon + one-line summary + actor + expandable detail), which is the clearest of the three we looked at. The per-type formats:

- **Call** ☎ — `Aug 14 · Call · Connected · 4m · with Dana · by 🟢Sarah` + a summary snippet (→ recording/transcript, doc 2).
- **Email** ✉ — `Aug 12 · Email ↗ · "Re: pricing" · with Omar · by 🟣me` + body snippet. (`↗` out / `↘` in.)
- **Text** 💬 — `Aug 12 · Text ↘ · with Dana · by 🟣me` + message snippet.
- **Meeting** 📅 — `Aug 20 · Meeting · "Demo" · Dana, Omar · 2:00 PM`.
- **Note** 📝 — `Aug 09 · Note · by 🟢Sarah` + 2-line preview (Journey 4a.6).
- **Task** ✓ — `Aug 15 · Task completed · "Send proposal" · by 🟣me` (or "Task created" / "Task due").
- **Field change** ⟳ — `Aug 14 · Stage: Demo → Won · by 🟢Sarah`.

Details on the format:
- **Avatars:** the **user** who did it always shows an **avatar** (photo if we have one, else colored initials) — that's the `🟢Sarah` / `🟣me` above. **Contacts** show an avatar too when enrichment gave us one, else initials. Internal-user avatars come from their profile.
- **Missing-field handling (edge case you flagged):** if a standard object is missing a piece the format wants (a Call with no disposition, an Email with no subject), that **segment is omitted** — we never render "undefined" or an empty `·`. So a bare call reads `Aug 14 · Call · with Dana · by Sarah`.
- **We verified the standard objects carry the fields these formats need** (doc 4 seeded shapes): Call has `direction`/`disposition`/`durationSec`; Email has `direction`/`subject`; Text has `direction`; Meeting has `title`/`startsAt`/attendees; Field-change has `old→new` from E1. Nothing critical is missing; if a new activity type is added, its format degrades the same graceful way.
- **How the feed is built** (the denormalized `CompanyActivity` read model, its write job, and the speed tradeoff) is in **Background jobs (E5)** and **Decisions for you** below — the entry text is rendered from each `CompanyActivity` row's fields + `preview`.

- **Benchmark (beat this):** HubSpot — company timeline aggregating all contacts' activity, with per-type entry formatting — https://knowledge.hubspot.com/records/associate-activities-with-records ; Salesforce — activity timeline (icon + type + who) — https://help.salesforce.com/s/articleView?id=sf.activities_timeline.htm ; Attio — record activity entries — https://attio.com/help/reference/managing-your-data/records/add-record-activities
- **Build docs:** internal — the feed reads the denormalized `CompanyActivity` rows by `companyId` (job E5, below) — one indexed query, no cross-contact join.

## Journey 4a.3 — Read the same company feed on the company's own record

*As a rep, I want the company record to show the full account feed by default, so that "the whole Acme picture" has one obvious home.*

1. The rep opens **Acme's** record (from the rail in 4a.1, or a Companies table).
2. Its Related rail lists **People** and **Deals**; its Activity feed shows the **full company feed** (all contacts) **by default** — the same feed Dana's record samples when scoped to "Everyone at Acme."
3. Same controls apply (owner filter 4a.4, deal filter 4a.5).

- **Benchmark (beat this):** HubSpot — company record timeline — https://knowledge.hubspot.com/records/work-with-records
- **Build docs:** internal — same `CompanyActivity` read as 4a.2.

## Journey 4a.4 — Filter the feed to my activity vs everyone's (teammates)

*As a rep on a shared account, I want to tell my own activity apart from a teammate's and optionally show only mine, so that ownership is always clear.*

1. **What the control looks like (your ask — it's small).** The feed header carries **three small inline controls in a row: `[ scope ] [ owner ] [ deal ]`.** The **owner** control is a **compact two-option segmented pill** — **`Everyone's · Mine`** — about the size of a chip, sitting between the scope dropdown (4a.2) and the deal dropdown (4a.5). It is not a big panel; it's a one-tap toggle. It defaults to **Everyone's** on a shared account.
2. Every item already shows **who did it** — "by Sarah" with her avatar — so a teammate's work is never hidden or mistaken for his.
3. He taps **Mine** → the feed shows only his own activity. (Single-user today, so this control is present now and already correct when teammates exist, doc 11.)

- **Benchmark (beat this):** HubSpot — filter a record timeline by user (the compact filter row) — https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline
- **Build docs:** internal — filter `CompanyActivity.userId`.

## Journey 4a.5 — Filter the feed to one deal

*As a rep at an account with several deals, I want to see activity for just one deal, so that a multi-deal account isn't a jumble.*

1. If Acme has more than one deal, each feed item shows a **deal chip** (e.g. "Acme Renewal").
2. **What the control looks like (your ask — also small).** The **deal** control is the third small inline control in the feed header (`[ scope ] [ owner ] [ deal ]`) — a **compact dropdown** showing the current selection (default **All deals**). It only appears when the account has 2+ deals; with one deal there's nothing to filter, so it's hidden. He opens it and picks **Acme Renewal**.
3. The feed narrows to activity linked to that deal. Picking **No deal** shows unlinked activity.

- **Benchmark (beat this):** HubSpot — associate + filter activities by deal — https://knowledge.hubspot.com/records/associate-activities-with-records
- **Build docs:** internal — filter `CompanyActivity.dealId`.

## Journey 4a.6 — Expand a long note without leaving the record

*As a rep, I want long notes shortened with a "See more," so that one wordy note doesn't bury the feed.*

1. Each note in the feed shows only its **first ~2 lines** (~160 characters).
2. He clicks **See more** → the note **expands in place** (no navigation, no drawer swap). The full body loads on demand.
3. He clicks **See less** → it collapses again.

- **Benchmark (beat this):** HubSpot — timeline note/activity "see more" (the inline expand to beat) — https://knowledge.hubspot.com/records/view-the-activity-on-a-record ; Linear — comment "show more" inline expansion — https://linear.app/docs/comments
- **Build docs:** internal — the feed sends the truncated `preview`; the full body is fetched on expand (keeps payloads tiny — see Technical decisions).

## Journey 4a.7 — Walk from a person to their company to a deal

*As a rep, I want to move a few steps out from a person — to the company, then to a specific deal — without getting lost, so that I can dig into the account when I need to.*

1. From Dana he clicks **Acme** (Related rail) → the company opens, showing **all its People and Deals** in its rail.
2. From Acme he clicks a **Deal** → the deal opens, showing **its calls and its people**.
3. From the deal he clicks a **Call** → the call opens with its recording/transcript/summary (doc 2) and links back up to the person/company/deal.
4. At every step the rail *shows* the shape of the account, so he only clicks to drill in — never to hunt.

- **Benchmark (beat this):** Attio — navigating between related records — https://attio.com/help/reference/managing-your-data/records/configure-record-pages
- **Build docs:** internal — each record's rail is built from its reference fields (doc 4.3).

## Journey 4a.8 — See prior calls at the account on the live call screen

*As a rep on a live call, I want the last few calls at this company right on the call screen, so that I don't fumble for context mid-dial.*

1. The dialer connects a call to Dana. The **live call screen** (doc 2) shows a collapsed **"Prior calls at Acme"** strip.
2. It lists the **top 3 recent calls** at Acme (truncated), each expandable.
3. He clicks the strip to expand and skim the last note before he starts talking.

- **Benchmark (beat this):** Nooks — enhanced prospect rows (prior-touch context on the row, before the dial) [how it works] — https://support.nooks.ai/articles/1995246243-enhanced-prospect-rows ; Nooks / Trellus marketing framing — https://www.nooks.ai/ai-dialer
- **Build docs:** internal — same `CompanyActivity` read as 4a.2, filtered to `kind = call`, limit 3. *(You had asked me to confirm you want this on the call screen too, not only the record page — yes; this journey is that confirmation.)*

## Journey 4a.9 (admin) — Choose which related records show on an object

*As an admin, I want to pick which related objects appear on a record and in what order, so that a custom object like "Partners" shows the right connections instead of a hard-coded set.*

1. The admin goes to **Settings → Data model → [object] → Record page**.
2. **These are two separate settings, not one (your ask).** The panel has **two independent lists:**
   - **Related rail — which *related objects* appear** (Company, Deals, Calls…), and in what order. This controls the **rail** (Journey 4a.1) — the clickable list of linked records.
   - **Activity feed — which *activity kinds* appear** (Calls, Emails, Texts, Notes, Tasks, Meetings, field changes, and any custom object's events), and the default scope. This controls the **feed** (Journeys 4a.2–4a.5).
   So a record could show Deals in the rail but hide field-changes from the feed — they're set separately.
3. In each list he **toggles which items show and drags to order** them, then saves.
4. Now that object's records show that rail + feed — so a custom "Partners" object gets the same treatment as People, without us pre-baking it.

- **Benchmark (beat this):** Attio — configure record pages (per-object sections) — https://attio.com/help/reference/managing-your-data/records/configure-record-pages ; HubSpot — customize the associations + activity a record shows — https://knowledge.hubspot.com/records/customize-records
- **Build docs:** internal — the `DetailLayout` config (doc 4b.11) gains **two** lists per object: `railObjects[]` and `feedKinds[]`.

## Journey 4a.10 — Link a company to its parent, and group / roll up by parent

*As a rep, I want to attach a company to its parent company and see the whole family together, so that I can work a franchise or a multi-subsidiary account as one account.*

A Company can point at another Company as its **parent** (`parentCompanyId`, doc 4 — a normal self-referencing record-reference field, Journey 4.3). This gives a one-level (extendable to multi-level) company hierarchy: parent ⇄ its subsidiaries.

**A. Set the parent (link).**
1. On a company record (e.g. "Acme West"), in the **Fields** area there's a **Parent company** field. He clicks it → a **record-reference picker** (the same async Combobox as any reference, doc 4.3 / 4.2 table) → types "Acme" → picks **Acme Inc**.
2. Saved optimistically. Guardrail: **a company can't be its own parent, and cycles are rejected** ("Acme Inc can't be a child of its own subsidiary") — validated on write, with a clear message (defensive, design-principles §III).

**B. See the family (reverse side).**
3. On the **parent** (Acme Inc), the **Related rail** (4a.1) gains a **"Subsidiaries" section** listing every company whose `parentCompanyId` points here (the reverse of the reference, resolved by job E4-style reverse lookup). Click one → opens it.
4. On a **child** (Acme West), the rail shows **"Parent: Acme Inc"** → click → opens the parent.

**C. Group and roll up by parent (the "group by them" ask).**
5. In any **Companies** table/list view, **Group by → Parent company** (doc 4c Journey 4.8.4) sections the rows by parent, each section header showing the parent name + **count** and numeric **roll-ups** (e.g. sum of open-deal amount across the family, total calls) — the same aggregation the group-by feature already does for any field.
6. **Roll up child activity to the parent (optional view toggle).** An **"Include subsidiaries"** toggle on a company's Activity feed (4a.2) and on account reports (doc 5b) folds the children's calls/emails/notes into the parent's view, so a manager sees the whole family's activity on the parent record. Off by default (keeps a single-branch view clean); on for "show me everything under Acme Inc."

**Defensive points.** Self-parent and cycle prevention (step 2). Deleting a parent doesn't delete children — it **clears their `parentCompanyId`** (they become top-level) and warns how many will be un-parented. Grouping by parent puts companies with no parent in an **"(No parent)"** section, never hidden.

- **Benchmark (beat this):** **Salesforce — Account hierarchy (`Account.ParentId`, "View Account Hierarchy")** for the parent/child model + hierarchy view — https://help.salesforce.com/s/articleView?id=sf.account_hierarchy.htm ; **Attio — relationship attributes** for the link UX — https://attio.com/help/reference/managing-your-data/attributes/relationship-attributes ; **Airtable — grouping records** for the group/roll-up-by-parent view — https://support.airtable.com/docs/grouping-records-in-airtable .
- **Build docs:** a nullable `Company.parentCompanyId` self-reference (doc 4 schema); reverse lookup reuses the reference-reverse mechanism (doc 4 job E4); group-by + section aggregates reuse doc 4c Journey 4.8.4; cycle-check on write.

---

## Background jobs

- **E5 — Activity fan-out (the engine behind 4a.2–4a.8).**
  - **Trigger:** on write of any timeline-eligible record — a call ends, a note is saved, an email/text is logged, a meeting is created, a task changes, or a tracked field changes.
  - **Steps:** write **one `CompanyActivity` row** for the event, carrying `companyId`, `contactId`, `userId`, `dealId`, `kind`, the `sourceId`, and a ~160-char `preview`. If the source is later edited or deleted, the same job updates or removes its row.
  - **Why:** this turns "show all activity across everyone at the company" (4a.2) into a **single indexed read** instead of a slow cross-contact join at page-open time.
  - **pg-boss:** retry ×5 with backoff; `singletonKey = sourceId` so rapid re-writes of one source collapse.
- **E4 — re-home on company change** (defined in doc 4): if a person moves companies, their past `CompanyActivity` rows re-point to the new company so each account feed stays correct.

---

## Decisions for you

**1. How to build the company-wide feed — join at read time vs. a denormalized feed. Decided (my pick): denormalized feed (E5).**

- **Option A — join at read time.** When the record opens, query Calls + Notes + Emails across all of Acme's people and merge them then. *Simple to build, but too slow as activity grows — and it runs every time a record opens, on the call-to-call hot path.* Rejected.
- **Option B — denormalized `CompanyActivity` feed (pick).** On every activity write, also write one summary row keyed by `companyId` (job E5). Reads become one indexed lookup. *Costs a little extra write work + a consistency job, but reads dominate here and reads must be fast.* **Chosen.**
- **Option C — a separate search/analytics store.** Overkill now. Rejected.

**Why B — quantified (your ask: put numbers on the speed tradeoff and re-evaluate).** Order-of-magnitude estimates; re-tune with real benchmarks:

| | Option A (join at read) | Option B (denormalized, pick) |
|---|---|---|
| **Read to open a record** (company with ~20 contacts, ~500 activities) | query + merge across **all 20 contacts'** Calls/Emails/Notes/… tables each open → a few hundred rows fetched + merge-sorted, **~50–200ms and it grows as the account grows** | **one** indexed range scan on `(companyId, occurredAt)` for the top ~20 → **~sub-10ms, flat** regardless of account size |
| **Extra write cost** | none | **one small row (~200 bytes)** per activity — negligible next to the Call/recording/transcript already being written |
| **Extra storage** | none | ~200 bytes × activities ≈ **~2 GB at 10M activities** — cheap vs. the recordings/transcripts already stored |

**Re-evaluation:** the read is on the **hot path** (every call, and reads vastly outnumber writes), and Option A's cost **grows with the account** while Option B's stays flat and small. Paying ~200 bytes + one tiny write to turn a 50–200ms growing join into a flat sub-10ms read is clearly worth it. **B confirmed.** (If activity volumes ever dwarf these numbers, revisit with Option C — a search/OLAP store.)

**2. Research that informed this (what the leaders do).**
- **HubSpot** is our model for the **company-wide feed** (4a.2–4a.5): its company timeline aggregates all contacts' activity and filters by type and user. [record layout](https://knowledge.hubspot.com/records/work-with-records) · [associate activities](https://knowledge.hubspot.com/records/associate-activities-with-records) · [filter timeline](https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline)
- **Attio** is our model for **clean one-click relationship navigation** (4a.1, 4a.7). [record pages](https://attio.com/help/reference/managing-your-data/records/configure-record-pages)
- **Nooks / Trellus** prove the *need* (4a.8): both bolt an AI "account research" summary onto other CRMs precisely because a rep needs prior-touch context before dialing — so we learn the pattern, not the implementation. [Nooks](https://www.nooks.ai/ai-dialer) · [Trellus](https://www.trellus.ai/learning-center/power-dialer)

---

## Technical decisions, trade-offs & edge cases

**Making it feel instant — what ships now vs. later (your ask to mark prefetch for later).**
- **Ships now (and is already fast):** the **denormalized feed** (E5, one indexed read), a **truncated-first payload** (only 2-line previews; full bodies on "See more", 4a.6), **cursor pagination**, and **optimistic writes** so a just-logged call appears immediately. On the numbers above these alone give a sub-10ms feed read, so the record already opens fast without any prefetch.
- **[LATER] — prefetch (an optimization, not a launch requirement):**
  - **Prefetch the queue** — while the rep is on the current call, background-prefetch the **next few queued records** so the next open renders from memory.
  - **Prefetch on hover/focus** for table rows he's about to open.
  These are worth doing **much later**, once the core is shipped and we're chasing the last few milliseconds; they add complexity (cache invalidation, wasted fetches) that isn't justified up front. So: build the feed + truncation now; add prefetch as a later polish pass.

**Edge cases.**
- **A teammate called this contact** → show it with the teammate's avatar + "by Sarah" (4a.4). Never hidden.
- **The account has many deals** → each item carries a deal chip; the deal filter (4a.5) narrows it.
- **A note is long** → 2-line preview + See more (4a.6), never the whole wall of text.
- **A record links to two parents** (e.g. a note on two people) → it appears under each, once per parent.
- **Null timestamps** in the feed → sort last.

## Data model (see doc 4 for the full schema)

```prisma
model CompanyActivity {     // NEW — denormalized feed for sub-100ms reads (job E5)
  id          String   @id @default(cuid())
  workspaceId String
  companyId   String
  contactId   String?       // which person the activity was with (contact badge — 4a.2)
  userId      String        // which rep did it (Everyone's/Mine filter — 4a.4)
  dealId      String?        // deal chip + deal filter (4a.5)
  kind        String        // call | email | text | meeting | note | task | field_change | custom
  sourceId    String        // the underlying Call/Note/Email id
  preview     String        // ~160-char truncated preview; full body lazy-loaded (4a.6)
  occurredAt  DateTime
  @@index([companyId, occurredAt])
  @@index([contactId, occurredAt])
}
```
