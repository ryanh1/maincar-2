# Journey Index

Every user journey in the spec, grouped by doc, in build-reading order. Regenerate by scanning `## Journey N.m` headers.

> **Status** is tracked at the ticket level, not here — see [../tickets/INDEX.md](../tickets/INDEX.md). A journey is *done* when all its tickets are done.


**~430 journeys across 46 docs.** (Doc-7 family split added 7c–7g; regenerate to refresh counts.)


## Doc 1 — Auth & Basic Dialer (P0)
`docs/journeys/1-auth-and-basic-dialer.md`
- **1.1** — First run and sign up
- **1.2** — Sign in (returning user)
- **1.3** — Switch or add a workspace
- **1.4** — Device check (green room before the call)
- **1.5** — Buy and select a number
- **1.6** — Make an outbound call
- **1.7** — Guided first-run onboarding (one thing at a time)

## Doc 1a — Account, Workspace & Profile Settings
`docs/journeys/1a-account-workspace-and-profile-settings.md`
- **1a.1** — Create a workspace
- **1a.2** — See and switch workspaces (Read-Many)
- **1a.3** — Rename a workspace / edit General settings
- **1a.4** — Join a workspace (accept an invitation)
- **1a.5** — Leave a workspace
- **1a.6** — Transfer ownership
- **1a.7** — Delete a workspace
- **1a.8** — Open Settings and find your way around
- **1a.9** — Edit your profile (name and job title)
- **1a.10** — Change your email
- **1a.11** — Set, crop, and remove an avatar photo
- **1a.12** — Security: change password & sign out everywhere
- **1a.13** — Preferences (timezone, locale, notifications)

## Doc 1b — Onboarding (first-run to first value)
`docs/journeys/1b-onboarding.md`
- **1b.1** — The first-run setup guide (the step engine)
- **1b.2** — Empty states that teach (onboarding without a wizard)
- **1b.3** — Get the first data in (fast path to "someone to call")
- **1b.4** — Connect your email (optional, high-value step)
- **1b.5** — Save progress, resume, dismiss, re-open
- **1b.6** — Re-engage a stalled setup
- **1b.7** — Team-invite onboarding (the second seat) **[LATER — multi-user, doc 11]**

## Doc 2 — Dialer: Calling Core
`docs/journeys/2-dialer-calling-core.md`
- **2.1** — Receive an inbound call
- **2.2** — Press digits during a call (DTMF)
- **2.3** — Record and transcribe a call (with consent)
- **2.4** — Disposition a call by hand
- **2.4a** — Configure the disposition bar
- **2.4b** — Configure next-step types
- **2.5** — Work the call screen: the core loop
- **2.8** — Review call history
- **2.9** — Open a call record
- **2.10** — Click to call
- **2.11** — Set your voicemail greeting
- **2.12** — Listen to voicemail
- **2.13** — Outbound number and caller-ID name
- **2.15** — Route an inbound call to my cell phone
- **2.14** — Configure call notifications

## Doc 2a — Dialer: Call AI (recommended disposition, summary, extraction)
`docs/journeys/2a-dialer-call-ai.md`
- **2.4c** — AI-recommended disposition
- **2.4d** — AI disposition eval fixtures & pipeline
- **2.6** — Get the AI call summary
- **2.7** — Configure AI summary & data-extraction templates
- **2.7a** — Default templates (seed + restore)
- **2.7b** — Pick which template a call uses (live)

## Doc 3 — Dialer at Scale: import, call lists & power dial
`docs/journeys/3-dialer-at-scale.md`
- **3.1** — Import a CSV of people into the CRM
- **3.1a** — Import a CSV of companies (and link people to them)
- **3.2** — Your call list is a CRM list or a view (there is no "call list" object)
- **3.4** — Power dial down a list or a view
- **3.4a** — Work an account by dialing its people (no special "company dialer")
- **3.4b** — See "other people at this account" while I'm calling
- **3.4c** — Dial a person's primary number, or each number in sequence
- **3.4d** — Do manual things mid-session without losing my place

## Doc 3a — Dialer at Scale: voicemail, numbers, SMS, transfer & compliance
`docs/journeys/3a-dialer-numbers-sms-compliance.md`
- **3.5** — Build and manage your voicemail-drop library
- **3.5a** — Transcribe a voicemail drop (so you can tell them apart)
- **3.6** — Drop a voicemail (manual or automatic)
- **3.7** — Local presence + caller-ID rotation (mostly automatic)
- **3.8** — Number health dashboard
- **3.10** — Send an SMS
- **3.10a** — Register a number for business texting (10DLC)
- **3.10b** — Auto opt-out (STOP) and compliance in the composer [DEFERRED — build late]
- **3.11** — Use and manage SMS templates
- **3.11a** — Receive and work texts: the SMS inbox, media, and reactions
- **3.13** — Live (warm) transfer to another rep [LATER — needs multi-user]
- **3.13a** — Presence (how we know a rep can take a transfer)
- **3.13b** — Notification settings: transfer events + per-event ring sounds
- **3.13c** — Put a caller on hold
- **3.12** — Click-to-call browser extension (with an on/off popup)
- **3.14a** — Do-Not-Contact: the situations, then the clicks
- **3.14b** — Calling-hours (quiet-hours) enforcement
- **3.14c** — Dead & unreachable contact points (numbers and emails)
- **3.14c.1** — How a number gets marked unreachable
- **3.14c.2** — What the rep sees when an unreachable number comes up
- **3.14c.3** — How line type drives SMS and dial order (your "why does it matter?")
- **3.14d** — Dial-order fields (sort your list the way you want)

## Doc 3b — Dialer analytics
`docs/journeys/3b-dialer-analytics.md`
- **3.9** — View the dialer-specific analytics slices

## Doc 3c — Inbound Calling, IVR & Routing
`docs/journeys/3c-inbound-ivr-and-routing.md`
- **3.15** — Configure an inbound number (greeting, hours, what it does)
- **3.16** — Build an IVR / auto-attendant menu (config)
- **3.17** — Route an inbound call to the right rep (the routing brain)
- **3.18** — Ring groups (config + behavior)
- **3.19** — The caller's runtime journey (menu → route → answer / transfer / voicemail)
- **3.20** — Punch through a callee's IVR / dial-by-name (outbound assist)

## Doc 4 — Objects, Fields & Schema
`docs/journeys/4-crm-data-and-views.md`
- **4.1** — Define a custom object
- **4.1a** — Archive or delete a custom object (a dangerous action, heavily guarded)
- **4.2** — Add and configure fields
- **4.2** — implementation note: field-editor libraries & shadcn fit (your ask)
- **4.2** — date entry is a real date picker, everywhere (your ask)
- **4.2a** — Archive or delete a field (guarded), and why standard fields can't be deleted
- **4.3** — Link objects with a reference field
- **4.4** — Set field rules
- **4.5** — See a field's change history
- **4.6** — Navigate the standard objects
- **4.6a** — View a standard object, and extend it with custom fields
- **4.S1** — Seed a new workspace (the algorithm)
- **4.S2** — Update the seed on a new release (backfill, without clobbering edits)
- **4.S3** — "Un-seed" / retire a default (guarded)
- **4.S4** — Generate a Prisma-style schema markdown for the dynamic objects (internal engineering tool)
- **4.I1** — Build a field index when uniqueness/indexing is turned on
- **4.I2** — Integrity sweep (catch type/schema drift before it bites)
- **4.I3** — Recover from corruption or a bad migration

## Doc 4a — Related Records & Company Activity
`docs/journeys/4a-crm-relations-and-related-records.md`
- **4a.1** — See a record's linked records (the Related rail)
- **4a.2** — See the whole company's activity on a person's record
- **4a.3** — Read the same company feed on the company's own record
- **4a.4** — Filter the feed to my activity vs everyone's (teammates)
- **4a.5** — Filter the feed to one deal
- **4a.6** — Expand a long note without leaving the record
- **4a.7** — Walk from a person to their company to a deal
- **4a.8** — See prior calls at the account on the live call screen
- **4a.10** — Link a company to its parent, and group / roll up by parent

## Doc 4b — Grid View: Power Editing & Keyboard
`docs/journeys/4b-power-views-editing-and-keyboard.md`
- **4b.1** — The multi-object grid view (one table, several record types)
- **4b.1a** — Compose a multi-object view (the click-path)
- **4b.2** — Edit in the table exactly like Google Sheets
- **4b.3** — Reorder, copy-paste, and fill
- **4b.4** — Color a field by a rule (e.g. next step by due date)
- **4b.5** — Rich dropdown fields: colors + display labels
- **4b.5.1** — Colors: auto-assigned, then edited (the exact user journey)
- **4b.5.2** — Display label ≠ stored value
- **4b.5.3** — Create, rename, relabel, recolor, reorder, and retire options (the exact user journey)
- **4b.7** — @-commands and /-commands everywhere (keyboard-first relations)
- **4b.7.1** — `@` to link a record, or to mention a teammate (your "how do we mention named users?" ask)
- **4b.7.2** — `@date` opens a date **picker**, Sheets-style (your ask)
- **4b.7.3** — `@` on a status field opens the **status options dropdown**, Sheets-style (your ask)
- **4b.7.4** — `/` runs a command in place (your "I don't understand — give examples + why" ask)
- **4b.8** — The record I'm calling lights up in the list
- **4b.9** — The tasks / reminders list view
- **4b.10** — Fit more (or less) on screen: zoom + density
- **4b.10.1** — Zoom the grid, Google-Sheets-style (your ask — replaces browser zoom)
- **4b.10.2** — Display density (a different control)
- **4b.11** — A record page you shape, and edit without "Save"
- **4b.11.1** — Customize the layout (the entry point + save, which was missing)
- **4b.11.2** — Edit any field with zero modal
- **4b.12** — The keyboard system (discoverable and yours to change)
- **4b.13** — Formatted fields that just work (phone, email, URL) — and custom formats for everything else
- **4b.13.6** — Custom display formats + validation for user-defined fields (your ask — yes, we need this, and phone/email/URL are instances of it)
- **4b.14** — Sort or filter by a multi-value column (the "how should we rank this?" journey)
- **4b.15** — Hide, group, and collapse columns

## Doc 4c — Tables, Views & Lists
`docs/journeys/4c-crm-tables-views-lists.md`
- **4.7** — Browse an object as a table (must feel like Google Sheets)
- **4.8** — Set up a table view
- **4.8.1** — Choose which columns show (and their order)
- **4.8.2** — Sort
- **4.8.3** — Filter (with AND / OR groups)
- **4.8.4** — Group rows into sections
- **4.8.5** — Edit a cell inline
- **4.8.6** — Control wrapping & truncation (the rep decides, we don't impose)
- **4.8.7** — Show or hide grid lines (per view; off by default on list views)
- **4.8.8** — Change Highlight mode ("what changed in the last N days")
- **4.9** — Save a view and switch to kanban
- **4.9a** — Manage a view (rename, edit, duplicate, delete, share, set default)
- **4.10** — Create and use a list

## Doc 4d — Records, Notes, Tasks & Mentions
`docs/journeys/4d-crm-records-notes-tasks.md`
- **4.11** — Open a record's detail page
- **4.11a** — Duplicate a record (clone a company)
- **4.13** — Write a note
- **4.14** — Create and manage tasks
- **4.15** — @mention someone or a record

## Doc 4e — Search, Command Palette, Notifications & Attention
`docs/journeys/4e-crm-search-notifications-attention.md`
- **4.12** — Global search and the command palette
- **4.16** — The notification inbox and its settings
- **4.17** — Full-text search (find the words inside calls, emails, and notes)
- **4.18** — Attention status + ownership on People and Companies

## Doc 4f — Composite Cells
`docs/journeys/4f-crm-composite-cells.md`
- **4f.1** — The three composite shapes (and chips inside a cell)
- **4f.2** — Configure a composite column (create)
- **4f.3** — Move around inside a composite cell (the sub-cursor)
- **4f.4** — Edit a sub-value (edit-through to the real record)
- **4f.5** — Add an item to a vertical/combination cell
- **4f.6** — Delete inside a composite cell (the "don't nuke everything" safeguard)
- **4f.7** — Copy, paste, fill, and the visible limit

## Doc 4g — AI Columns
`docs/journeys/4g-crm-ai-columns.md`
- **4g.1** — Add an AI column and write its instruction
- **4g.2** — Write the instruction with `{{variables}}` (mail-merge fields)
- **4g.3** — Run a cell (or the whole column), and what it looks like while it works
- **4g.4** — Output types: casting and validation
- **4g.5** — Auto-write mode: provenance and the human-edit pin
- **4g.6** — What happens behind the scenes (model, tools, system prompt, params)
- **4g.7** — Evals: making sure a prompt/model change doesn't break columns
- **4g.8** — Suggest & review: accept, edit, or reject an AI update

## Doc 5 — Comms: Email, Calendar & Meetings
`docs/journeys/5-comms-email-and-calendar.md`
- **5.2** — Relate emails and events to CRM records
- **5.4** — Connect and manage mailboxes
- **5.4a** — Mailbox deliverability and health
- **5.5** — Compose, send, and template email
- **5.5a** — Dynamic, liquid, and AI merge fields
- **5.5b** — Signatures: configure, choose, and manage
- **5.6** — Calendar: view, draft, and send events
- **5.7** — Integrations: Google and Microsoft OAuth
- **5.7a** — Verify granted scopes and repair a partial grant
- **5.10** — Record a meeting with a Recall.ai bot
- **5.11** — Recording rules (the settings for meeting recording)

## Doc 5a — CRM Data Ops & Hygiene (bulk, undo, dedupe, merge, trash, import, extension, retention, audit)
`docs/journeys/5a-crm-data-ops-and-hygiene.md`
- **5.1** — Bulk edit, delete, and add to a list
- **5.1a** — Undo and undo history (app-wide)
- **5.3** — Record hygiene: auto-create, dedupe, merge, restore
- **5.12** — Import a CSV into CRM objects
- **5.13** — Chrome extension: add a Person from a LinkedIn profile [P3]
- **5.14** — Data retention, deletion, and the audit log

## Doc 5b — Reporting, Dashboards & Profiles
`docs/journeys/5b-reporting-and-dashboards.md`
- **5.8** — The reporting home and the report lifecycle
- **5.8a** — Activity report (metrics × time grid)
- **5.8b** — Pipeline transition waterfall (and the snapshot pipeline)
- **5.9** — Custom pivot builder + advanced metrics
- **5.9a** — Cohort / decay report
- **5.9b** — Report templates that ship
- **5.9c** — Dashboards: assemble, title, annotate, arrange, refresh
- **5.9d** — User profile pages and profile dashboards
- **5.9e** — Computed fields and the formula engine (no custom language)
- **5.9f** — Scheduled report delivery (subscriptions)

## Doc 6 — Call Intelligence
`docs/journeys/6-call-intelligence.md`
- **6.1** — Read the diarized transcript
- **6.1a** — Estimate who each outside speaker is (identification algorithm)
- **6.2** — Play the call, synced to the transcript
- **6.3** — Read and regenerate the summary
- **6.4** — Comment on a moment
- **6.5** — See conversation analytics
- **6.6** — Maintain the tracked-vocabulary dictionary (competitors + more)
- **6.7** — Review and correct a call's record match
- **6.8** — Detect and render the transcript language
- **6.9** — See the full account timeline
- **6.10** — Generate a deal / account brief

## Doc 6a — Meeting (Video) Intelligence
`docs/journeys/6a-meeting-video-intelligence.md`
- **6a.1** — Watch a recorded meeting, synced to the transcript
- **6a.2** — Know who each participant is (identity, the video way — better than phone)
- **6a.3** — Meeting summary + structured extraction (your "(b)")
- **6a.4** — Live in-meeting assist / next action (your "(a)")
- **6a.5** — Comment, and see meeting analytics
- **6a.6** — The meeting in the deal timeline: playback & navigation (your "(c)")
- **6a.7** — Bulletproof calendar-event ↔ recording matching (your bulletproof question)

> **The AI is organized in three layers** (see [7 — AI Copilot](7-ai-copilot.md) for the map, and [../ideas/doc7-coverage-audit.md](../ideas/doc7-coverage-audit.md)): **Surfaces** (7 stack · 7h · 7i · 7j · 7e · 7g), **Engines** (7c · 7b · 7f · 7k · 7a · 7l), **Data** (7d).

## Doc 7 — AI Copilot (the map + the post-call stack)
`docs/journeys/7-ai-copilot.md`
- The **AI map** (three layers: Surfaces / Engines / Data) + the flagship **post-call stack**:
- **7.1** — After a call, accept the next actions (+ the per-card-type table)
- **7.2** — The talk-and-accept loop
- **7.3 / 7.3a** — qualification → *moved to [7h](7h-structured-notes.md)* · **7.4 / 7.11** → *[7e](7e-agent-surface.md)* · **7.5** → *[7j](7j-ask.md)* · **7.6** → *[7i](7i-ai-fields.md)* · **7.7** → *[7d](7d-enrichment.md)* · **7.8** → *[7f](7f-skills.md)* · **7.9** → *[7k](7k-provenance.md)* · **7.10** → *[7g](7g-chrome-extension.md)* · **7.12** → *[backlog](14-backlog.md)*

## Doc 7a — AI Eval Fixtures
`docs/journeys/7a-copilot-eval-fixtures.md`
- ~24 action-focused eval fixtures (user-prompted + event-triggered) + the AI-jobs→fixtures table + a "what's hard" discussion. (Reference/table content, not `Journey N.m` headers.)

## Doc 7b — Copilot Automations & the AI Event Engine
`docs/journeys/7b-copilot-automations.md`
- **7b.1** — The AI event engine (trigger substrate; decision half → [7c](7c-ai-decision-engine.md))
- **7b.2** — AI runs view → [7c](7c-ai-decision-engine.md) G1/G2
- **7b.3** — Conditional reminders → *replaced by [7c](7c-ai-decision-engine.md)*
- **7b.4–7b.13** — recipes (rethought through 7c, or standalone features 7c uses; each also an [7a](7a-copilot-eval-fixtures.md) fixture)

## Doc 7c — The AI Decision Engine ("open loops")
`docs/journeys/7c-ai-decision-engine.md` — journeys **7c.1–7c.32**, grouped by engine phase (group letter is a label; 7c.N is the reference):
- **A. Trigger — 7c.1–7c.11** — 7c.1 live call · 7c.2 hang-up stack · 7c.3 email in · 7c.4 email sent · 7c.5 SMS in · 7c.6 voicemail/no-answer · 7c.7 calendar change · 7c.8 CRM change · 7c.9 scheduled check (core wake) · 7c.10 rep prompt · 7c.11 rep hand-edit
- **B. Decide — 7c.12–7c.15** — 7c.12 the gate · 7c.13 the five-move think · 7c.14 create/re-arm a loop · 7c.15 escalation ladder
- **C. Surface & approve — 7c.16–7c.20** — 7c.16 in-app · 7c.17 away queue + digest · 7c.18 on-a-call hold · 7c.19 "needs you" · 7c.20 Slack/text [LATER]
- **D. Act — 7c.21–7c.23** — 7c.21 auto internal · 7c.22 approved external · 7c.23 undo
- **E. Close & learn — 7c.24–7c.26** — 7c.24 auto-close · 7c.25 hand back · 7c.26 learn from accept/edit/reject
- **F. Configure — 7c.27–7c.30** — 7c.27 permission grid · 7c.28 write a skill · 7c.29 on/off · 7c.30 earn autonomy
- **G. Audit — 7c.31–7c.32** — 7c.31 rep loop history · 7c.32 super-admin traces
- Reference tables: every-trigger→skills/tools/prompt; the OpenLoop + AiPermissionRule data model.

## Doc 7d — Enrichment
`docs/journeys/7d-enrichment.md`
- **7d.1–7d.7** config (settings · sources CRUD · keys ours/BYOK · per-field waterfall · BYO HTTP/agent/formula)
- **7d.8–7d.20** usage (fields · auto-enrich on create/list · manual-button map · bulk column · reverse · array fan-out vs composite cells · logos · signal/web/list/deep-research agents)
- **7d.21–7d.26** monitoring (cost · accuracy · super-admin health) + LinkedIn stance + the three scenarios

## Doc 7e — The Data-Chat Agent
`docs/journeys/7e-agent-surface.md`
- **7e.1–7e.12** — ask/change data · agent placement per context · the tool/API contract (consistency fix) · where it runs (infra options + pick) · sessions · skills-as-chips · reasoning/tool-call display · stop/rewind/redo · system prompts + clarifying questions · change settings by chat · browser context

## Doc 7f — The Skills Library
`docs/journeys/7f-skills.md`
- **7f.1–7f.9** — what a skill is · where code runs · save-from-result · create-from-scratch · metadata nudge · browse/read · edit/version · delete/share · invoke · evals · built-ins

## Doc 7g — The Chrome Extension
`docs/journeys/7g-chrome-extension.md`
- **7g.1–7g.4** — install & grant (off by default) · tool-call page read · manual send · how/when it connects (answers 7.10.2)

## Doc 7h — Structured Notes  *(Surface)*
`docs/journeys/7h-structured-notes.md` — was "qualification (7.3)", generalized
- **7h.1–7h.5** — fill in as you talk · placement/long-forms · finalize · several notes per record · relate to another record
- **7h.6–7h.7** — template CRUD (qualification / objections / summary / action-items / custom)

## Doc 7i — AI Fields & Columns  *(Surface)*
`docs/journeys/7i-ai-fields.md` — was 7.6, merged with the grid view [4g](4g-crm-ai-columns.md)
- **7i.1–7i.4** — add an AI field · run one/column · self-current summaries · when it recomputes (+ staleness cap)

## Doc 7j — Ask (Q&A over a call or account)  *(Surface)*
`docs/journeys/7j-ask.md` — was 7.5, fully specced
- **7j.1–7j.3** — ask one transcript · ask an account · generate a brief; + the Ask setup (prompt/tools/model/format) and 6 question-type fixtures

## Doc 7k — Provenance (the trust layer)  *(Engine)*
`docs/journeys/7k-provenance.md` — was 7.9, now shared
- **7k.1–7k.3** — see a value's source (chip + popover) · verify · reject/correct (evidence trail preserved)

## Doc 7l — The AI Platform  *(Engine)*
`docs/journeys/7l-ai-platform.md` — consolidated cross-cutting choices
- models & tiers · cost design · the tool contract · framework (Vercel AI SDK) · the 11 guardrails · hallucination guardrail

## Doc 8 — Developer Platform
`docs/journeys/8-developer-platform.md`
- **8.1** — Create an API key and call the REST API
- **8.1a** — Sync your own business data into the CRM (upsert, external IDs, bulk)
- **8.2** — Subscribe to outbound webhooks
- **8.3** — Connect a third-party app with OAuth
- **8.4** — Let an AI tool read and write via MCP
- **8.5** — Query the workspace with read-only SQL
- **8.6** — Download a report as CSV
- **8.7** — Scopes, permissions & authorization (your questions on 8.1 / 8.2 / 8.3)
- **8.8** — API reference: the schemas (endpoints, webhook events, MCP tools)

## Doc 9 — Deal Board & Forecasting
`docs/journeys/9-deal-board-and-forecasting.md`
- **9.1** — The deal board (viewing)
- **9.1a** — Filter the board by ownership
- **9.1b** — Closed Won and Closed Lost on the board
- **9.1c** — Other board filters
- **9.2** — Deal warnings and AI-surfaced risks
- **9.2a** — Configure warnings and risk skills (config, distinct from the usage above)
- **9.3** — Multi-threading view (who's engaged, who's missing)
- **9.4** — Deal timeline (every touch in one place)
- **9.5** — Recommended next action per deal
- **9.5.1** — Seeing the recommended action
- **9.5.2** — How the action is produced (and the options we weighed)
- **9.5.3** — Viewing and accepting / rejecting the action
- **9.6** — Stage-weighted pipeline forecast (simplified)
- **9.7** — Pipeline-change waterfall (entry point)
- **9.8** — Scorecard schema: create, edit, version, archive (CRUD) [LATER, needs multi-user]
- **9.9** — Scorecard usage: score a call & review over time [LATER, needs multi-user]

## Doc 10 — Workflows & Automation
`docs/journeys/10-workflows-and-automation.md`
- **10.1** — Build a workflow
- **10.2** — Triggers (the six that matter)
- **10.3** — Conditions, branches, and waits
- **10.4** — Actions (including an AI step)
- **10.5** — Test before you trust it (dry-run on one record)
- **10.6** — Run history, enable/disable, and versioning
- **10.7** — The workflow library (list, duplicate, delete)
- **10.8** — Monitor my workflows & get alerted when one breaks
- **10.9** — Super-admin: monitor workflows across all workspaces

## Doc 11 — Multi-user, Teams, Permissions & Collaboration
`docs/journeys/11-multiuser-teams-and-permissions.md`
- **11.1** — Invite someone to the workspace [NEAR-TERM]
- **11.2** — Accept an invitation [NEAR-TERM]
- **11.3** — Roles: rep / manager / admin (+ super-admin) [NEAR-TERM]
- **11.3.1** — Change a member's role [NEAR-TERM]
- **11.3.2** — Remove a member (offboard) [NEAR-TERM]
- **11.4** — Teams [NEAR-TERM]
- **11.4.1** — Create a team [NEAR-TERM]
- **11.4.2** — View teams (list + one team) [NEAR-TERM]
- **11.4.3** — Edit a team: rename, change lead, add/remove members [NEAR-TERM]
- **11.4.4** — Delete (archive) a team [NEAR-TERM]
- **11.4.5** — Rollup & forecasting by team (how the numbers add up) [NEAR-TERM model, [LATER] manager UI]
- **11.5** — Slack integration → moved to [doc 11a](11a-slack-integration.md) [NEAR-TERM, high value]
- **11.6** — Per-list access control [LATER; one cheap near-term hook]
- **11.6.1** — Grant access to a list [LATER]
- **11.6.2** — How the resolver decides (most-permissive-wins) [LATER]
- **11.6.3** — The near-term cheap hook (build this early) [NEAR-TERM]
- **11.7** — Field-level security (restrict who edits an attribute) [LATER]
- **11.8** — SAML SSO + SCIM provisioning [LATER, enterprise gate]
- **11.9** — Data retention & GDPR erasure [LATER; one cheap near-term hook]

## Doc 11a — Slack Integration
`docs/journeys/11a-slack-integration.md`
- **11a.1** — Build the MainCar Slack app (us, one-time) [NEAR-TERM]
- **11a.2** — Connect Slack to your workspace (customer admin, once) [NEAR-TERM]
- **11a.3** — Make a channel available to the bot (the one Slack-side step) [NEAR-TERM]
- **11a.4** — Map events → channels (in our app) [NEAR-TERM]
- **11a.5** — A deal event fires and the message posts (runtime) [NEAR-TERM]
- **11a.6** — What the notifications look like (Block Kit) [NEAR-TERM]
- **11a.7** — Manage or disconnect the connection [NEAR-TERM]

## Doc 13 — Superadmin Console: entry, overview, workspaces & audit
`docs/journeys/13-superadmin-console.md`
- **13.1** — Get into the console (sign in + IP gate + step-up)
- **13.2** — Read the overview (system health at a glance)
- **13.3** — Browse workspaces (read-many)
- **13.4** — View one workspace (read-one)
- **13.5** — Suspend or reactivate a workspace (update)
- **13.6** — Adjust seats and limits (update)
- **13.7** — Impersonate a user for support (audited, time-boxed)
- **13.8** — Export or delete a workspace's data (honors retention)
- **13.9** — Read the admin audit log (read-many)
- **13.10** — Browse any table in the database (internal data browser) — *and why not everything is a user-facing object* [LATER]

## Doc 13a — Superadmin: AI & credit cost monitoring
`docs/journeys/13a-superadmin-cost-monitoring.md`
- **13a.1** — Meter every consumption call at the moment it happens (the algorithmic journey)
- **13a.2** — Read the cost dashboard (where the money goes)
- **13a.3** — Investigate a cost spike (drill-down)
- **13a.4** — Create a cost budget (create)
- **13a.5** — Edit or delete a cost budget (update / delete)
- **13a.6** — Budget breach → alert & auto-throttle (background job)
- **13a.7** — One wrapper's full job: prompts, evals, and params in one place — *and does it cover transcription too?*

## Doc 13b — Superadmin: model routing, provider keys & kill-switches
`docs/journeys/13b-superadmin-model-and-killswitches.md`
- **13b.1** — View the per-feature model routing (read)
- **13b.2** — Set or change a feature's model (update / create)
- **13b.3** — Add or rotate a provider key (create / update, encrypted)
- **13b.4** — Flip a kill-switch: disable a provider instantly (update)
- **13b.5** — Create or edit a feature flag with rollout targeting (create / update)
- **13b.6** — Global circuit-breaker: pause AI or enrichment (update)

## Doc 14 — Backlog
`docs/journeys/14-backlog.md`
- *(no `Journey N.m` headers — reference/standards content)*

## Doc 15 — Sequences & Campaigns (multi-step outreach)
`docs/journeys/15-sequences-and-campaigns.md`
- **15.1** — Create a sequence (the builder)
- **15.2** — The step types (what each does, auto vs. task)
- **15.2a** — AI-draft a step's email body
- **15.3** — Add, edit, reorder, and time steps
- **15.4** — A/B test a step (variant bodies, pick a winner)
- **15.5** — Enroll one person (from a record or the dialer)
- **15.6** — Bulk-enroll from a list or view
- **15.7** — Work today's sequence tasks (the daily queue)
- **15.8** — Auto-exit and branch logic (If X then Y)
- **15.9** — Pause / resume, and edit a live sequence (versioning)
- **15.10** — Read: per-sequence and per-step analytics
- **15.11** — List, clone, archive, and delete sequences (CRUD)
- **15.12** — Compliance & deliverability on every send (the gate)

## Doc 17 — Billing, Credits & Subscriptions
`docs/journeys/17-billing-credits-and-subscriptions.md`
- **17.1** — Add / update / remove a payment method
- **17.2** — Subscribe to a plan (Create)
- **17.3** — Change or cancel a subscription (Update / Delete)
- **17.4** — Buy extra usage credits, and auto-top-up (your "credits at any tier")
- **17.5** — View usage, invoices & billing history (Read)
- **17.6** — Superadmin sets up plans, prices, meters & credit packs (operator CRUD)
- **17.7** — Billing notifications
