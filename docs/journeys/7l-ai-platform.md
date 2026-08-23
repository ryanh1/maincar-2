# Doc 7l — The AI Platform (models, cost, guardrails, framework)

Part of the **AI Copilot** family — an **Engine** (shared machinery). See the map in [7 — AI Copilot](7-ai-copilot.md). This is the **one place** the cross-cutting AI decisions live, so they aren't restated in every doc (guidance: consolidate tech choices). Every AI surface and engine inherits from here.

---

## 1. Models — super-admin-set, three tiers

- **No per-user model picker anywhere.** The workspace's **super-admin** picks the model on the backend; reps only accept/edit/reject output.
- **Three default tiers (swappable):**
  - **`claude-haiku-4-5`** — cheap, high-volume: the decision-engine **gate** ([7c.12](7c-ai-decision-engine.md)), classify/derive AI fields ([7i](7i-ai-fields.md)), enrichment research steps ([7d](7d-enrichment.md)), auto-titles, intent routing.
  - **`claude-sonnet-5`** — the default for judgment: the decision-engine **think** ([7c.13](7c-ai-decision-engine.md)), the data-chat agent ([7e](7e-agent-surface.md)), Ask ([7j](7j-ask.md)), structured-note extraction ([7h](7h-structured-notes.md)), summary AI fields, draft-follow-up.
  - **`claude-opus-5`** — reserved for rare hard cases (deep research judgment, hard extractions).
- **Provenance records which model wrote each value** ([7k](7k-provenance.md)), so a later model swap is auditable.

## 2. Cost — the always-on-inference design

The full sourced math is in [../ideas/decision-engine-benchmarks.md](../ideas/decision-engine-benchmarks.md) (Factor 6). The levers, in order of impact:
1. **A cheap gate on every event** decides whether a full inference is worth it (filters ~80%). Biggest single lever.
2. **Model tiering** (Haiku gate → Sonnet decision → Opus rare).
3. **Prompt caching, consciously scheduled** — the "recently-read" discount is TTL-bound (5–30 min), so batch an account's events to ride it, and keep a short always-fresh account summary for checks that wake days later.
4. **Batch API (−50%)** for non-urgent nightly work.
5. **Per-customer / per-feature cost tracking + budget caps** with alerts.
6. **One job per loop** (singleton) so an event burst becomes one run.

Modeled effect: a naive always-on loop ~$59k/month → ~$4k/month (labeled estimate).

## 3. The tool contract — one set of typed tools

Defined once as **JSON-schema function definitions**, shared by the data-chat agent, the decision engine, the MCP server (doc 8.4), and the REST API (doc 8) — so nothing drifts. The full contract + the consistency rules (resource tools take an `object` argument; verbs only for non-records) live in **[7e.4](7e-agent-surface.md)**. Every write routes through the **accept + provenance** path.

## 4. Framework, structured output, async

- **Agent framework — a plain tool-calling loop on the Vercel AI SDK.** *Options:* roll-your-own (max control, rebuild everything); **Vercel AI SDK** (thin, MIT, provider-agnostic, gives streaming + tool loop + MCP + human-approval `needsApproval`); OpenAI/Claude Agent SDK (welded to one provider — rejected); LangGraph/Mastra (heavy, for durable multi-day graphs — overkill for single-step calls). **Pick: the Vercel AI SDK loop** — our actions are mostly single-step typed tool calls, so a loop (not a graph) fits, and the SDK gives provider-agnosticism + streaming + human-approval for free. Reach for **Mastra/LangGraph** only if a skill needs durable, resumable, multi-day state.
- **Structured output — the model's JSON-schema / tool-use mode, never prose parsing.** Extractions, field writes, and record CRUD come back schema-locked, typed and validated before they touch a record.
- **Async — pg-boss** (the Postgres queue, doc 8): skill runs, signal research, batch enrichment, decision-engine wakes. Durable chat/agent runs are pg-boss jobs keyed by session+run ([7e.5](7e-agent-surface.md)). In-loop proposals and the ranker run **inline** for latency; only batch/scheduled/long work is queued.

## 5. Guardrails — the ways it can go wrong, and the guard for each

*(These are also graded as fixtures in [7a](7a-copilot-eval-fixtures.md).)*

1. **AI proposes a 500-record overwrite** → `maxRecords` cap + explicit bulk-confirm + undo.
2. **AI writes a value with no source** → **no provenance, no write** — the write path refuses it ([7k](7k-provenance.md)).
3. **Accept an email with the wrong recipient** → Accept opens a **composer** (never auto-send); recipient shown; undo window.
4. **AI overwrites a human-edited field** → human edits are **pinned / user-authoritative**; AI won't overwrite without an explicit accept.
5. **A skill reaches records the user can't see** → skills scoped to the invoker's **visible records only**.
6. **A bad-prompt skill rewrites everything** → `maxRecords` cap + **dry-run preview on a sample** + every write through accept/provenance.
7. **Double-press / retry duplicates an action** → **idempotency by `proposalId`**; one job per loop.
8. **AI wrongly sets a deal to Closed-Won** → stage changes are **proposals** (accept), reversible + logged; won/lost always needs an explicit accept.
9. **Enrichment overwrites a good value with a worse one** → **run-conditions** (only-if-empty) + provenance + user-authoritative fields untouched.
10. **A skill tries to mass-email** → skills **cannot auto-send email**; email always opens a composer / needs a human send; rate-limited.
11. **A tool leaks across workspaces** → every tool enforces `workspaceId` (doc 8).
- These are enforced by the **permission matrix** ([7c.27](7c-ai-decision-engine.md), the auto/ask/never grid) plus the write-path guards above.

## 6. The hallucination guardrail

Extraction and Q&A must return an explicit empty ("not mentioned") when the source doesn't support a value — never invented. The web agent must attach a citation to every written value — **no citation, no write** ([7d](7d-enrichment.md), [7k](7k-provenance.md)).

## Cross-doc references
Consolidates the tech-choices + model + guardrail material formerly scattered in doc 7's tail. Referenced by every AI doc: [7c](7c-ai-decision-engine.md), [7d](7d-enrichment.md), [7e](7e-agent-surface.md), [7f](7f-skills.md), [7h](7h-structured-notes.md), [7i](7i-ai-fields.md), [7j](7j-ask.md), [7k](7k-provenance.md).
