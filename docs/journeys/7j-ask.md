# Doc 7j — Ask (Q&A over a transcript or an account)

Part of the **AI Copilot** family — a **Surface**. See the map in [7 — AI Copilot](7-ai-copilot.md). This **replaces and expands the old Journey 7.5**. It shares the agent machinery ([7e](7e-agent-surface.md)) but is a **scoped, read-only Q&A surface** — you ask about *one call* or *one account*, and it answers with citations.

**How it differs from the data-chat agent ([7e](7e-agent-surface.md)):** the agent is global and can *change* data; **Ask is scoped to the open record and read-only** — no writes, so it needs no accept/reject gate. It's the fast "what did they say about budget?" box, not the "clean up 200 leads" agent.

Under each journey: **Benchmark (beat this)** = the product to match. **Build docs** = the technical page.

---

## Journey 7j.1 — Ask about one call's transcript

*As a rep, I want to ask a question about a specific call and get a cited answer, so I don't re-read the transcript.*

1. **Where the box is.** On a **call record**, an **"Ask about this call"** box sits at the top of the transcript panel (a single-line input with a placeholder "Ask about this call…"). It is **scoped to that one transcript** — not the global agent.
2. **What typing does.** He types *"What did they say about budget?"* and hits Enter → the answer appears **inline, in a panel right below the box** (it does **not** open the global agent or navigate away). Each claim carries a **provenance chip** ([7k](7k-provenance.md)) that jumps to the exact transcript moment.
3. **If the transcript doesn't support an answer (then):** it says **"not mentioned in this call,"** never a guess (the hallucination guardrail).
- **Benchmark (beat this):** Attio — research agent (account-level Q&A) — https://attio.com/blog/introducing-attio-ai-research-agent ; Glean — deep-linked citations (jump to the exact source moment) — https://developers.glean.com/guides/chat/deep-linked-citations . **Build docs:** the retrieval tool + `claude-sonnet-5`; the Ask setup (below).

## Journey 7j.2 — Ask about an account's whole history

*As a rep, I want to ask about everything that ever happened on an account, so I get context without opening every call and email.*

1. **Where.** On an **account/deal record**, the same **Ask** box answers over the account's **full history** — every call, email, meeting, and note (built on the CRM timeline).
2. **What typing does.** Same inline-answer panel; each claim's provenance chip jumps to the **source interaction** (a call moment, an email).
- **Build docs:** the retrieval tool queries the account timeline (doc 4/6); large histories are retrieved, not dumped (see setup).

## Journey 7j.3 — Generate a brief

*As a rep, I want a one-click account/deal brief before a call, so I walk in prepared.*

1. A **"Brief me"** button (next to the Ask box) generates a structured brief across all interactions — last 3 touches, open opportunity, champion, risks — each claim carrying a provenance chip.
- **Benchmark (beat this):** Attio — research agent — https://attio.com/blog/introducing-attio-ai-research-agent . **Build docs:** a built-in "brief" skill ([7f](7f-skills.md)) scoped to the account.

---

## How the Ask agent is set up (your ask: prompts, tools, model, params)

- **System prompt (summary).** *"You answer questions about {scope: this call / this account} for a salesperson. Use only the provided transcript/timeline. Cite the exact source moment for every claim. If the source doesn't support an answer, say 'not mentioned' — never guess. Be brief."* Read-only: the prompt grants **no write tools**.
- **Tools exposed.** A single **`retrieve` tool** over the scoped source (transcript for 7j.1; account timeline for 7j.2) that returns the relevant passages with locators (callId+timestamp, or emailId). No CRUD, no send — Ask cannot change data.
- **Model.** **`claude-sonnet-5`** (answer quality + faithful citation matter); a cheap **`claude-haiku-4-5`** first pass classifies the question type and picks retrieval filters.
- **How the data is formatted for the model (your ask).** Transcripts are passed as **timestamped, speaker-labeled turns in markdown** (not raw JSON) — the model reads prose better and can cite a turn. For an **account** (too big for the window), the `retrieve` tool returns only the **top passages** (semantic search over the timeline) as markdown, plus a short **rolling account summary** ([7i](7i-ai-fields.md)) as a header — never the whole history dumped in.
- **Skills.** The **"brief"** skill ([7f](7f-skills.md)) powers 7j.3. Ask otherwise needs no skills for plain Q&A.
- **Other params.** Citation is **required** (no-citation → "not mentioned"); temperature low; a per-answer token cap.

## Fixtures — the question types Ask must handle

*You asked for a larger set organized by type, with 2–3 examples each, and what each needs. These become graded fixtures in [7a](7a-copilot-eval-fixtures.md).*

| Type | Examples | Data needed | Format | Tools/skills |
|---|---|---|---|---|
| **1. Fact lookup (one call)** | "What did they say about budget?" · "Did they name a competitor?" · "What's the timeline they mentioned?" | that call's transcript | timestamped turns (markdown) | `retrieve` (transcript) |
| **2. Objection / risk** | "What objections came up and how were they handled?" · "What's the biggest risk on this deal?" | transcript(s) + notes | markdown turns + notes | `retrieve`; may reuse the objections structured-note ([7h](7h-structured-notes.md)) |
| **3. Account brief / history** | "Brief me on Acme before my 2pm." · "What's happened on this account this quarter?" | full account timeline | retrieved top passages + rolling summary ([7i](7i-ai-fields.md)) | `retrieve` (timeline) + brief skill |
| **4. Stakeholder / relationship** | "Who's the economic buyer and how do I reach them?" · "Who have we talked to at this account?" | contacts + roles + interactions | contact records + timeline | `retrieve` |
| **5. Commitment / next-step recall** | "What did I promise on the last call?" · "What were the action items?" | last call transcript + action-items note | markdown turns + note | `retrieve`; action-items structured-note ([7h](7h-structured-notes.md)) |
| **6. Cross-call comparison** | "How has their sentiment changed across our calls?" · "What changed since our first call?" | multiple transcripts | retrieved passages per call | `retrieve` (multi-call) |

**Data-availability check (your ask — make sure it *can* answer).** Types 1/2/5 need the transcript (we have it — Deepgram, doc 2). Types 3/4/6 need the account timeline + contacts (we have them — doc 4/6). The only thing that must be **built** is the `retrieve` tool (semantic search over transcript + timeline with locators) and the rolling summary header ([7i](7i-ai-fields.md)). Everything else the app already stores.

## Background jobs
- **Ask** runs **inline** (not queued) for latency — it's a fast read. The `retrieve` tool hits a vector index over transcripts + timeline (built once, updated on new activity).

## Cross-doc references preserved
Replaces the old **Journey 7.5**. Related: the agent [7e](7e-agent-surface.md) (the writeable global version), provenance [7k](7k-provenance.md), structured notes [7h](7h-structured-notes.md), AI fields [7i](7i-ai-fields.md), fixtures [7a](7a-copilot-eval-fixtures.md).
