# Doc 7e — The Data-Chat Agent (surface, sessions, tools)

Part of the **AI Copilot** family (head: [7 — AI Copilot](7-ai-copilot.md)). This is the **agent you talk to** — the chat/command surface that answers questions over your data and *changes* it through the accept/reject gate. It was **split out of the old Journeys 7.4 and 7.11**. The decision engine ([7c](7c-ai-decision-engine.md)) is the *unprompted* AI; this doc is the *prompted* AI. They share one tool set and one accept path.

**What this doc covers:** where the agent sits in each context (call / command bar / full screen / record), the **tool + API contract** it uses (and the consistency fix you asked for), **where it runs** (infrastructure, with options and a recommendation), **sessions** (search/rename/pin), **skills as chips**, **what you see as it reasons and calls tools**, and the **mid-run controls** (stop, rewind, redo). Changing settings by chat lives here too (7e.11).

**Models are super-admin-set** ([7 global rule](7-ai-copilot.md)); default `claude-sonnet-5` for the agent loop, `claude-haiku-4-5` for cheap intent/routing.

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the technical page.

---

## Journey 7e.1 — Open the agent and ask over your data

*As a rep, I want to ask a question about my data in plain language and get an answer with links to the records, so I don't build a report.*

1. **Entry points (three ways in):** press **Cmd-J** anywhere (opens the docked panel); click the **✨ Ask** field in the **top command bar**; or the **AI panel on a record** (the record's right rail).
2. He types or dictates: *"Which open deals haven't I touched in two weeks?"* Each row in the answer **links to its record**.
3. Dictation: the input has a **mic button** + push-to-talk; we reuse the call transcription (Deepgram) for speech-to-text; the text drops into the box for review before send — it **does not auto-execute** (any write still goes through accept/reject, 7e.2).
- **Benchmark (beat this):** Attio — embedded AI — https://attio.com/platform/ai ; ChatGPT (chat session UX). **Build docs:** the tool contract (7e.4); the durable runner (7e.5).

## Journey 7e.2 — Change data from chat (the accept/reject batch)

*As a rep, I want to tell the agent to change records and review the changes before they happen, so nothing mutates silently.*

1. He types: *"Set all of those to At risk and add a task to call them."*
2. The agent proposes the writes as an **accept/reject batch** — a list of the exact changes (record, field, old → new) with **Accept all / Reject all** and per-row accept. Never a silent mutation.
3. On accept, it performs the creates/updates (idempotent) and stamps **provenance** (source = chat, the instruction, the model) — [7k](7k-provenance.md).
- **Benchmark (beat this):** Zapier — Human-in-the-Loop approval step — https://help.zapier.com/hc/en-us/articles/38731463206029 . **Build docs:** the accept path shared with [7c](7c-ai-decision-engine.md).

## Journey 7e.3 — Where the agent sits, in each context (placement)

*As a rep, I want the agent in the right shape for what I'm doing — a slim rail on a call, a full screen for a big cleanup — so it never fights for space or hides what I need.*

Four contexts, four shapes (this is the "where on the page" answer, per guidance point 1e):

1. **On a live call → a slim right rail.** The agent shares the **copilot rail** ([7](7-ai-copilot.md)) beside the call. Narrow (~320px), single-column, big touch targets, no overlay of the dialer. Used for quick mid-call asks ("find a better number").
2. **From the top command bar → a docked side panel (~400px).** The default between-calls shape: overlays the record on the right so context stays visible; a **drag handle** resizes; last size remembered.
3. **A big task → one-click full-screen.** A **⤢ expand** control turns the panel into a full-screen view for long outputs/tables/multi-step runs. **Esc** or **⤡ collapse** returns it to the docked panel.
4. **On a record → the record's AI rail.** Scoped to that record ("research them" resolves to the open record without naming it, [7c.10](7c-ai-decision-engine.md)); same panel, pre-scoped.
   ```
   command bar ask        docked panel (~400)     full screen
   ┌───────────────┐      ┌──────────┬──────┐     ┌────────────────────┐
   │ ✨ Ask…       │      │ record   │ chat │     │ chat + big table    │
   └───────────────┘      │          │ ▸    │     │                     │
                          └──────────┴──────┘     └────────────────────┘
   ```
- **Why this shape set (first-principles + benchmarks):** ChatGPT/Claude use a docked panel that expands; Claude Code shows a durable side surface; a call needs a *non-overlapping* slim rail. One panel component, four widths/scopes — not four separate UIs (keeps it coherent, avoids tab sprawl). **Benchmark (beat this):** ChatGPT side panel + expand; Claude Code side surface. **Build docs:** one `AgentPanel` component, `width` + `scope` props.

## Journey 7e.4 — The tool + API contract (and the consistency fix)

*As an engineer, I want one clean, consistent tool set the agent, the MCP server, and the REST API all share, so nothing drifts and the model reads it easily.*

**Your API-consistency point, addressed.** You were right that `create_task` sitting outside `create_record` is inconsistent. The fix: **make records uniform, and keep verbs only for things that truly aren't records.**

1. **Resource tools (one shape for every object).** `search`, `get_record`, `create_record`, `update_record`, `upsert_record`, `delete_record`, `add_to_list` — each takes an **`object` argument** (`company` / `person` / `deal` / **`task`** / **`note`** …). So **a task is just `create_record(object:"task", …)`** — no special `create_task`. This is the consistency you asked for: one CRUD shape, every object.
2. **Action tools (genuinely not a record).** `send_email`, `run_report`, `enrich`, `run_skill` — verbs, because they *do* something beyond writing a row. Writes still route through the accept + provenance path.
3. **Defined once.** The contract is one set of **JSON-schema function definitions**, so the **chat, the MCP server (doc 8.4), and the REST API (doc 8) never drift** — same names, same shapes.
- **Design for the agent to read easily (your ask):** resource-oriented + few verbs; **descriptive names + one-line descriptions on every field**; enums for `object` and `status`; **errors returned as structured, actionable messages** (not stack traces) so the model can self-correct. **Benchmark (beat this):** Claude tool use — define tools — https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools ; Attio/Stripe resource-oriented APIs. **Build docs:** the shared function schema (doc 8).

## Journey 7e.5 — Where the agent runs (infrastructure — options + recommendation)

*As an engineer, I want a long agent task to survive a tab close and a device switch, so "clean up 200 stale leads" finishes even if the rep walks away.*

**The options (guidance point 4 — options, tradeoffs, a pick):**
- **A. In-request loop** (run the tool loop inside the HTTP request). *Simplest; lowest infra.* But it **dies on tab close / disconnect / a 60s serverless timeout** — wrong for long tasks.
- **B. Server-side durable job** (the tool loop runs as a background job keyed by session + run id; the client streams from a stored event log). *Survives tab close, refresh, device switch; a late client replays.* Costs: you build the streaming + resume plumbing (or get it from the SDK).
- **C. Hosted agent runtime** (LangGraph Platform / Temporal-backed). *Durable + checkpointed out of the box.* But **lock-in + extra cost**, and heavier than our single-step tool calls need.

**Pick: B — a durable job on our existing pg-boss runner + the Vercel AI SDK tool loop.** Rationale: our actions are mostly **single-step typed tool calls**, so a loop (not a graph) fits; the Vercel AI SDK gives streaming + a tool loop + human-approval for free and stays provider-agnostic (matches the [7 tech choice](7-ai-copilot.md)); pg-boss gives durability with no new infra (matches doc 8). Only if a skill needs **multi-day checkpointed** state do we reach for a durable engine (the [7c benchmarks](../ideas/decision-engine-benchmarks.md) cover Temporal/LangGraph) — the exception, not the default.

1. **Steps.** A run is a pg-boss job keyed by `session:runId`. Token deltas + tool-call events are appended to a stored **event log**; the client streams via **SSE** (server-sent events — a one-way live feed); a reconnecting client **replays from the log**. On completion, a toast fires even if the rep is elsewhere in the app.
- **Build docs:** Vercel AI SDK — https://ai-sdk.dev/ ; pg-boss (doc 8); SSE event log.

## Journey 7e.6 — Sessions: list, search, rename, pin (CRUD)

*As a rep, I want to find and resume a past chat, so a useful run isn't lost.*

1. **Read (list).** A **session list** in the panel: each session **auto-titled from the first message**, newest first, showing a **status dot** (working… / needs input / done / error).
2. **Search.** A search box filters sessions by title + message text — important because the panel is compact (your "operate in a small space" ask): search collapses a long history to what matters; the list is virtualized.
3. **Update (rename / pin).** Row **⋯ → Rename** (inline edit) and **Pin** (pinned sessions sort to the top). **Delete** removes a session (soft-delete, recoverable 30 days).
4. **Resume.** Click a session → instant resume with full history (replayed from the event log, 7e.5).
5. **Multiple concurrent sessions.** Several can run at once; a **global active-run count** badge; a toast when a background run finishes while he's elsewhere.
- **Benchmark (beat this):** ChatGPT / Claude session list (search, rename, pin). **Build docs:** `ChatThread` (doc 7) + auto-title (a cheap `claude-haiku-4-5` call on the first message).

## Journey 7e.7 — Skills as chips (@-mention / slash)

*As a rep, I want to pull a saved skill into a prompt like an @-mention, so I invoke it without remembering exact syntax.*

1. Typing **`/`** or **`@`** in the input opens a **picker** of skills ([7f](7f-skills.md)) and, for `@`, records/lists. Choosing one inserts a **chip** (`/find-mobile`, `@Acme`) — a solid, styled token, not raw text, so it's unambiguous and editable as a unit (backspace deletes the whole chip).
2. **Auto-format on recognition:** if the rep types a known skill slug in full, it **auto-converts to a chip** on space (like an @-mention resolving). Unknown slugs stay plain text.
3. A chip shows a tooltip (what the skill does + its last eval score, [7f](7f-skills.md)).
- **Benchmark (beat this):** Slack/Linear `/`-command + @-mention chips; Claude Code slash commands. **Build docs:** a chip input component over the `Skill` registry.

## Journey 7e.8 — What you see as it reasons and calls tools

*As a rep, I want to watch the agent work — what it's thinking and doing — so I trust it and can catch a wrong turn.*

1. **Reasoning** streams as a compact, collapsible **"thinking" line** ("Looking at open deals untouched for 14 days…") — summarized, not a raw chain, so it's readable. Off by a setting for reps who want just results.
2. **Tool calls** render as **activity cards**, one per call: an icon + a human label ("Querying deals…", "Updating 12 records"), a **status** (running / done / failed), and an **expander** showing the input → output for that call (the exact query, the rows touched). This is the transparency + audit surface.
3. **A live plan / todo list** for multi-step runs (pending / in-progress / done), so the rep sees where it is.
- **Benchmark (beat this):** Claude Code streamed steps + TodoWrite; Manus "Manus's Computer" replay — https://manus.im/blog/manus-sandbox ; Cursor agent step view. **Build docs:** render the SSE event log (7e.5) as reasoning lines + tool cards.

## Journey 7e.9 — Stop it, rewind, and redo (mid-run controls)

*As a rep, I want to stop the agent, or go back to an earlier point and try a different instruction, so a wrong turn is cheap to fix.*

1. **Stop midway.** A **Stop** button interrupts the run at the next safe point; **work already done stays** (nothing is silently rolled back); any **pending (unaccepted) writes are discarded**. The session shows "stopped."
2. **Rewind to an earlier message.** Each user message has a **↩ edit/rewind** control; choosing it **forks the session** from that point (the later messages are kept on the old branch, not destroyed) and lets him retype the instruction — modeled on going back in a chat thread and Claude Code's checkpoints.
3. **Redo a message.** A **↻ retry** on an assistant answer re-runs that step with the same input (useful after a transient tool failure).
4. **See a tool's execution result** any time via the activity card expander (7e.8) — including a failed call's error.
- **Edge cases (If X then Y):** *Stop during an external send* → sends are queued/drafted, never mid-flight, so Stop can't cut a half-sent email. *Rewind past an already-performed write* → the fork doesn't undo performed writes; it warns "3 changes were already applied on the original branch" with a link to undo them individually.
- **Benchmark (beat this):** Claude Code `/rewind` checkpoints + Esc-interrupt; LangGraph time-travel (fork from a checkpoint) — https://docs.langchain.com/oss/python/langgraph/use-time-travel . **Build docs:** checkpoint per message on the event log; fork = new thread pointer.

## Journey 7e.10 — System prompts, and when it asks clarifying questions

*As an engineer/admin, I want to know how the agent is instructed and when it should ask rather than guess, so it behaves predictably.*

1. **System prompts (how it's instructed).** A layered instruction stack: our **base agent prompt** (tone, the accept-before-external rule, cite-or-say-unknown, safety), plus the **relevant skill(s)** loaded on demand (progressive disclosure — only a skill's name/description sits in context until it's needed, then the body loads, [7f](7f-skills.md)). **Data is passed as compact markdown, not raw JSON**, where the model reads prose better (a record becomes a small labeled block); large result sets are passed as a tool result the model queries, not dumped into the prompt.
2. **When it asks a clarifying question.** It asks — rather than guessing — when the request is **ambiguous in a way that changes the action** (which "VP"? which of two Acme records? delete or archive?). Low-stakes ambiguity it resolves with a sensible default and says so.
3. **Structured clarifying questions (your ask — like Claude Code / Codex).** When it needs a decision, it can render a **small structured question** — a titled prompt with 2–4 tappable options (and a free-text "other") — instead of a wall of text, so the rep answers in one tap. This is the same "needs you" pattern as [7c.19](7c-ai-decision-engine.md).
- **Benchmark (beat this):** Claude Code / Codex structured clarifying questions; Salesforce Atlas "ask a clarifying question mid-task" — https://www.salesforce.com/agentforce/what-is-a-reasoning-engine/atlas/ . **Build docs:** the base-prompt template; the structured-question component (shared with 7c).

## Journey 7e.11 — Change a setting by chat (safely)

*As an admin, I want to change configuration by asking — "add these disposition options" — but never have a setting change silently.*

1. He types: *"Update disposition options — add X, Y, Z and remove A."*
2. Config actions (dispositions, statuses, templates) are **first-class tools** but always route through the **accept/reject + provenance** path: the agent **proposes** the config change (shown as a clear before/after), he **confirms**, it applies. No settings change without a confirm.
- **Benchmark (beat this):** Claude Code (acts across the workspace with approval). **Build docs:** config-mutation tools behind the accept path (7e.2).

---

## Journey 7e.12 — Give the agent the page I'm looking at (browser context)

*As a rep on a prospect's LinkedIn/website, I want to ask the agent about that page without copy-paste.* — This is the **Chrome extension**; its journeys live in **[7g — Chrome Extension](7g-chrome-extension.md)** (off-by-default, a `get_current_page_context` tool, page content treated as untrusted data). Referenced here because the agent *consumes* it as a tool result.

---

## Background jobs
- **Agent run** — trigger: a rep prompt that needs tools/long work. Durable pg-boss job keyed `session:runId`, streams via SSE, replays on reconnect (7e.5). Inline for short single-tool answers; queued for long/batch work.
- **Auto-title** — trigger: first message in a new session. A one-off `claude-haiku-4-5` call → session title (7e.6).

## Data model
Reuses `ChatThread` / `ChatMessage` (doc 7) and the shared tool schema (doc 8). Adds `ChatThread.pinned`, `ChatThread.title`, and an append-only `AgentRunEvent` log (runId, seq, type=token|tool_call|tool_result|plan, payload) powering streaming, replay, and rewind.

## Cross-doc references preserved
Replaces the old **Journeys 7.4 and 7.11**. Related: the decision engine [7c](7c-ai-decision-engine.md) (shares the tool set + accept path), skills [7f](7f-skills.md), enrichment [7d](7d-enrichment.md), provenance [7k](7k-provenance.md), the developer platform / MCP [8](8-developer-platform.md), the Chrome extension [7g](7g-chrome-extension.md), eval fixtures [7a](7a-copilot-eval-fixtures.md).
