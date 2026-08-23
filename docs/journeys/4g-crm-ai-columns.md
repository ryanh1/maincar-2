# Doc 4g — AI Columns

Part of the **CRM Data & Views** family (head: [4 — Objects, Fields & Schema](4-crm-data-and-views.md); grid & editing in [4b](4b-power-views-editing-and-keyboard.md), composite cells in [4f](4f-crm-composite-cells.md), relations in [4a](4a-crm-relations-and-related-records.md)).

**What this doc covers.** A rep can add a **column whose every cell runs an AI instruction he wrote** — "summarize their last call", "classify this account A/B/C", "find their LinkedIn headline" — using **that row's own data** as input, with a **▶ play** button to run one cell or the whole column. This is the **table-native (in-grid) face** of the AI-fields feature; the feature itself — config, use cases, when-it-recomputes, the model — lives in **[7i — AI Fields & Columns](7i-ai-fields.md)**, which this doc pairs with. Related engines: enrichment [7d](7d-enrichment.md), provenance [7k](7k-provenance.md), evals [7a](7a-copilot-eval-fixtures.md). This doc owns the CRM grid journeys; [7i](7i-ai-fields.md) owns the feature.

**It was split out of doc 4b** (was Journey 4b.6) because it's a feature in its own right. Benchmarks: **Clay's AI/Claygent columns** (the column-of-AI model) and **Scratchpad's AI CRM Updates** (the *configuration* UX — AI-drafted starter prompt, an auto-write-vs-review toggle, a context-scope picker, and test-on-a-real-call before deploy). Scratchpad demo (see it work): https://www.youtube.com/watch?v=s7iFQYwE8DY .

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the page that tells the coding agent how to build it.

---

## Journey 4g.1 — Add an AI column and write its instruction

*As a rep, I want to add a column that runs an AI instruction I write, so that I can enrich or classify hundreds of records without leaving the table.*

1. **Entry point.** In a table, he clicks the **`+` at the far right of the header row** → the "add column" menu → **AI column** (alongside the normal field types).
2. A **configuration panel slides in from the right** (a form; **fully tab-navigable** — `Tab`/`Shift+Tab` between every control, `Enter` to confirm, no mouse required):
   ```
   ┌──────────── New AI column ────────────┐
   │ Name        [ Industry            ]   │
   │ Instruction ┌───────────────────────┐ │
   │             │ Given {{company.name}}│ │
   │             │ and {{company.website}}│ │
   │             │ return the industry.  │ │
   │             └───────────────────────┘ │
   │             [ + Insert variable ] [✨ Draft with AI] │
   │ Output type  ( Single-select ▾ )      │
   │   → options from ( Industry field ▾ ) │
   │ Context      ( Latest call ▾ )        │
   │ Use web      [x] search the web       │
   │ Model        ( Auto ▾ )               │
   │ When it runs ( Only if empty ▾ )      │
   │ On a result  (•) Suggest & review  ( ) Auto-write │
   │ [ Test on a call… ] [ Preview on this row ] [ Save ] │
   └───────────────────────────────────────┘
   ```
3. He fills in the **instruction** (the prompt — Journey 4g.2), the **output type** (4g.4), the **context scope** (step 5), whether it may **search the web**, the **model** (4g.6, default Auto), a **run condition**, and the **review mode** (step 6), then clicks **Save**. The column appears with a **▶ play** button in each cell.
4. **Draft the prompt with AI (writing a good prompt is the hard part).** Instead of writing the instruction from scratch, he clicks **✨ Draft with AI**: given the **column name** + **output type** + **object**, the app generates a solid starter instruction using our prompt best practices (clear task, cite-or-say-unknown, the right `{{variables}}` pre-inserted). He then edits it. *(This is Scratchpad's "select a field → AI drafts the prompt for you" — it turns a blank box into an editable draft.)* Uses `claude-sonnet-5` for the one-off draft (quality over cost, since it runs once).
5. **Context scope — how much history feeds each run.** A **Context** dropdown controls what interaction data is available to the instruction: **Latest call** (default for "next step"-type fields — focus on what just happened), **All interactions** (for methodology/summary fields that need the whole history), **Emails only**, **None (just this record's fields)**. This maps the resolved `{{variables}}` + the interaction context handed to the call (4g.6). *(Scratchpad calls this out: "some fields need all customer interactions; next-steps fields want just the latest call.")*
6. **Review mode — does the AI write, or suggest?** A radio: **Suggest & review** (default — the AI proposes; a human accepts/edits/rejects before it's written — Journey 4g.8) or **Auto-write** (the AI writes the value directly, pin-on-edit — Journey 4g.5). Default is **Suggest & review** for safety; a rep flips to Auto-write for high-trust, low-stakes enrichment (e.g. "HQ city"). *(Scratchpad exposes exactly this toggle: "manually review and accept, or let the AI automatically replace/update.")*
7. **Test before you deploy.** **Test on a call…** lets him pick a real record/call and run the instruction **without saving the column**, seeing the exact output it would produce. Only when he's happy does **Save** deploy it across the column. (This is broader than **Preview on this row**, which shows the resolved prompt for the focused grid row — see 4g.2.)

- **Benchmark (beat this):** **Scratchpad — AI CRM Updates** for the config UX (AI-drafted prompt, context picker, review-vs-auto toggle, test-on-a-call-then-deploy) — https://www.youtube.com/watch?v=s7iFQYwE8DY ; **Clay — add a Claygent/AI column** — https://www.clay.com/claygent ; **Airtable — AI field** — https://www.airtable.com/platform/ai
- **Build docs:** doc 7.6 (AI fields) ; the `AiColumn` model (below). "Draft with AI" is a one-shot meta-prompt (name+type+object → instruction).

## Journey 4g.2 — Write the instruction with `{{variables}}` (mail-merge fields)

*As a rep, I want my instruction to pull in each row's own data automatically, so that one prompt works across every record.*

1. The instruction supports **`{{field}}` placeholders that are replaced with each row's own values** at run time (the mail-merge idea, per row).
2. He types **`{{`** (or clicks **Insert variable**) → a **menu of this object's fields** appears, including **related fields one hop out** (`{{company.name}}`, `{{person.title}}`, `{{deal.stage}}`).
3. He picks one → it inserts as a **variable chip** in the instruction (not raw text), so it can't be typo'd and is visually distinct.
4. **At run time, per row,** every chip is substituted with that row's value before the call is sent. `"Given {{company.name}} and {{company.website}}, return the industry"` becomes a concrete prompt per company.
5. **Missing values:** if a row lacks a variable's value, the cell is **skipped and flagged** ("missing company.website") rather than sending a broken prompt — so we don't spend a call on garbage.
6. **Preview:** **Preview on this row** shows the **fully-resolved prompt** for the focused row, so he sees exactly what will be sent before running.

- **Benchmark (beat this):** Clay — Claygent Builder [how it works: column-to-variable mapping, and the review step when a Claygent is deployed to a table with different column names] — https://university.clay.com/docs/claygent-builder ; Clay — prompt engineering crash course [how it works: how variables are written into the prompt] — https://university.clay.com/lessons/prompt-engineering-crash-course-limitless-research
- **Build docs:** the `{{}}` resolver reuses the mention/field resolver (doc 4.15 / doc 4b.7).

## Journey 4g.3 — Run a cell (or the whole column), and what it looks like while it works

*As a rep, I want clear feedback while the AI runs, so that I know what's happening and can trust the result.*

1. **Run one cell:** he clicks the **▶ play** button in a cell. The cell enters a **processing state** — a **shimmer/skeleton with a small spinner and "running…"** (it does **not** show a fake value; AI output is server-computed, so per doc 4b's optimistic-updates rule we show a real pending state, never an optimistic guess).
2. **Run the column:** the header has **Run all** and **Run empty**. Clicking runs the column across the view as a **background job (H2/H3, doc 7)**, with a **progress toast** ("Industry — 128 / 540 done · 3 failed") and each cell flipping from shimmer → value as it completes.
3. **On success:** the cell shows the value plus a small **provenance chip** (4g.5).
4. **On failure** (timeout, model error, missing input): the cell shows an **error chip with the reason on hover** and a **↻ retry**; the run continues for other cells. Nothing is silently blank.
5. **Rate/cost guard:** Run-all confirms before large runs ("This will run 540 cells (~$X, ~Y min). Continue?") so a rep never accidentally spends a lot.

- **Benchmark (beat this):** Clay — run column + progress ; Airtable AI — per-cell generate state
- **Build docs:** doc 7.6/7.7 (the runner, batching, rate limits) ; pg-boss job H2/H3 (doc 7).

## Journey 4g.4 — Output types: casting and validation

*As a rep, I want the AI's answer to land as the right kind of value, so that I can filter, sort, and use it like any field.*

1. He sets the **output type**: **text · number · date · single-select** (into an existing field's options) **· list/array**.
2. Every result **casts + validates to that type before it's written** (structured outputs): a number parses, a date normalizes, a **single-select must land on a real existing option** (else it's flagged, not invented), a phone → E.164, an email is shape-checked.
3. **List/array** outputs can **fan out to child rows** per doc 7.7's rules (e.g. "competitors mentioned" → one row each).
4. If the value can't cast, the cell is **flagged invalid** (accept-but-flag, doc 4b.13) rather than writing garbage.

- **Benchmark (beat this):** Clay — typed AI outputs
- **Build docs:** Claude — structured outputs — https://platform.claude.com/docs/en/build-with-claude/structured-outputs ; doc 7.7 (typecast + array fan-out rules).

## Journey 4g.5 — Auto-write mode: provenance and the human-edit pin

*As a rep, I want an AI column set to Auto-write to fill values directly but let me override, so that I trust the data and my correction sticks.*

This is the behavior when the column's **review mode = Auto-write** (Journey 4g.1 step 6). For **Suggest & review** (the default), see Journey 4g.8.

1. Each AI value carries a **provenance chip** (doc 7.9): the **model**, the **prompt version**, and the **source(s)** it used (e.g. the web page). Hover shows detail.
2. If a **human edits** an AI cell, the cell is **pinned** — provenance flips to "edited by [rep]" and **re-runs skip it** (Run-all won't overwrite a human correction unless he explicitly clears the pin).

- **Benchmark (beat this):** Clay — data provenance ; internal doc 7.9
- **Build docs:** doc 7.9 (provenance model) ; a `pinned` flag on the cell.

## Journey 4g.6 — What happens behind the scenes (model, tools, system prompt, params)

*As an admin, I want to know exactly what the AI column does under the hood, so that I can reason about cost, speed, and accuracy.*

Each cell run is **one Claude call through the doc-7 field engine** — it does **not** invent its own engine. Concretely:

- **Model (our name-the-model rule, retunable):**
  - **Default `Auto`** picks by task: **`claude-haiku-4-5`** for simple extract/classify/format (cheap, fast, run over hundreds of rows), escalating to **`claude-sonnet-5`** when the instruction is reasoning-heavy or web-augmented.
  - The admin can pin a specific model in the panel. Rationale: cost×speed dominates at scale; Haiku handles the bulk, Sonnet the hard minority.
- **Tools available to the call:**
  - **Web search / fetch** (our Claygent-equivalent, **doc 7.7d**) when **Use web** is on — for live facts (headcount, funding, news).
  - **Internal record context** — the row's own fields and one-hop related records, supplied via the resolved `{{variables}}` (no separate tool call; it's in the prompt).
- **System prompt (fixed, versioned):** instructs the model to (1) **return only the declared output type** via structured output, (2) **cite sources** when web is used, (3) say **"unknown" rather than guess** when the answer isn't supported (anti-hallucination), and (4) be concise. The **per-column instruction** is the user turn; the system prompt is ours and versioned (so provenance can record `prompt version`).
- **Params:** low **temperature** (deterministic enrichment), a **max-tokens** cap sized to the output type, structured-output schema per type, **retry ×3** with backoff, and **batching/rate-limit** handled by the doc-7 runner (H2/H3).

- **Benchmark (beat this):** Clay — Claygent Builder [how it works: the web-search toggle, and when to turn it off for faster, more consistent runs] — https://university.clay.com/docs/claygent-builder ; Clay — Use AI integration overview [how it works: model + params exposed on the column] — https://university.clay.com/docs/use-ai-integration-overview
- **Build docs:** doc 7.6 (AI fields), doc 7.7 (enrichment + batching), doc 7.7d (web agent), doc 7.9 (provenance) ; Claude API — https://platform.claude.com/docs/en/build-with-claude/structured-outputs

## Journey 4g.7 — Evals: making sure a prompt/model change doesn't break columns

*As an admin (and us internally), I want AI columns tested against known cases before a prompt or model change ships, so that quality doesn't silently regress.*

1. **Fixture set (doc 7a — copilot-eval-fixtures).** For each common column *kind* (classify, extract, boolean, web-lookup) we keep **fixtures**: `(sample row, instruction, expected output)`.
2. **When it runs:** the eval pipeline runs **whenever the system prompt, the default model, or a shipped template changes** (a CI job), and on a schedule to catch model drift.
3. **Metrics:**
   - **classify / boolean / single-select** → exact-match accuracy vs expected.
   - **any type** → **type-validity** (does it cast to the declared type?) and **empty-when-unknown** rate (does it say unknown instead of hallucinating?).
   - **web-augmented** → **source-citation present** rate.
4. **Gate:** a change that drops a metric below its threshold is blocked. An **LLM-as-judge** step (model: **`claude-sonnet-5`**) grades open-ended text outputs against a rubric.

- **Benchmark (beat this):** internal doc 7a (eval fixtures) ; OpenAI/Anthropic eval patterns
- **Build docs:** doc 7a (copilot-eval-fixtures) — the fixtures + runner live there; this doc's columns register their fixtures into it.

## Journey 4g.8 — Suggest & review: accept, edit, or reject an AI update

*As a rep, I want the AI to propose a field value with its source, so that I can accept, tweak, or dismiss it — nothing changes my CRM without my say-so.*

This is the default review mode (Journey 4g.1 step 6). The AI produces a **suggestion**, not a written value; the real field stays as-is until a human acts. It's the CRM-surface face of the copilot's accept/reject loop (doc 7.6 AI fields, doc 7.9 provenance) and matches the design rubric's "an AI/enrichment write is never silently authoritative" rule (design-principles §III).

1. **A run produces suggestions, not writes.** When a Suggest-&-review column runs (▶ / Run-all, 4g.3), each cell that would change shows a **suggestion badge** — the current value stays visible, with a small **"AI suggests: <new value>"** affordance (a dot/underline on the cell, like Scratchpad's next-step suggestion). No value is written yet.
2. **Open the suggestion.** He clicks the cell (or a suggestions inbox — step 6). A small popover shows: **Current → Suggested**, the **source** (the call/email/web page the AI used — click to open it), the **model + prompt version** (provenance, doc 7.9), and three actions: **Accept**, **Edit & accept**, **Reject**.
3. **Accept** → the suggested value is written to the field (cast/validated per 4g.4), provenance records "AI-suggested, accepted by [rep]". **Edit & accept** → he tweaks the value first (e.g. fix a next-step wording), then it's written as his value with an "AI-assisted" note. **Reject** → the suggestion is discarded, the field is untouched, and the rejection is logged (feeds evals, 4g.7).
4. **Keyboard-first (bulk triage).** In a column of suggestions he can move cell-to-cell and **`A` accept / `E` edit / `R` reject / `X` skip**, so clearing 50 suggestions is keyboard-only (design-principles §IV keystroke target). **Accept all** (with a confirm + count) exists for high-trust columns.
5. **Nothing silently expires.** A pending suggestion persists until acted on or superseded by a newer run (newer run replaces the pending suggestion and says so). If the underlying source changes, the suggestion is re-computed on the next run.
6. **Suggestions inbox.** All pending AI suggestions across the workspace also collect in a **review queue** (ties into the attention/notifications surface, doc 4e, and the copilot proposals, doc 7) so a rep can clear them in one place, not hunt cell by cell.

**Defensive points.** The field is never mutated by the AI in this mode — accept is the only write. A suggestion equal to the current value is suppressed (no noise). Rejects and edits are recorded so the eval loop (4g.7) can measure suggestion quality (accept rate).

- **Benchmark (beat this):** **Scratchpad — AI recommended updates** (see the suggestion + source, edit from there, accept) — https://www.youtube.com/watch?v=s7iFQYwE8DY ; **Clay/Attio** enrichment review; internal **doc 7.6 / 7.9** (the copilot accept/reject + provenance engine this reuses).
- **Build docs:** doc 7.6 (AI-field proposals), doc 7.9 (provenance), doc 4e (attention/review queue) ; an `AiSuggestion` row per pending proposal (data model below).

---

## Example instructions the rep might add (and what they return)

A starter set — a few of these **ship as one-click templates** (marked ★). "Web" = needs the web agent (4g.6).

| # | Instruction | Output type | Web? |
|---|---|---|---|
| 1 ★ | Summarize their last call in 2 sentences | text | no (uses transcript) |
| 2 ★ | Classify this account's fit — A / B / C | single-select (A/B/C) | no |
| 3 | Find this person's current job title | text | yes |
| 4 ★ | What industry is this company in? | single-select (Industry) | yes |
| 5 | Estimate the company's employee count | number | yes |
| 6 | Is this an ICP fit? | checkbox (yes/no) | no |
| 7 | Sentiment of the last call | single-select (pos/neu/neg) | no (transcript) |
| 8 | Which competitors were mentioned in their calls? | list (fan-out) | no (transcript) |
| 9 ★ | Draft a one-line personalized email opener | text | optional |
| 10 | Company HQ city | text | yes |
| 11 | Funding stage | single-select | yes |
| 12 | Does their website mention [our category]? | checkbox | yes |
| 13 | Primary pain point from the discovery call | text | no (transcript) |
| 14 | Renewal-risk score 1–5 | number / rating | no |
| 15 | Suggested next best action | text | no |
| 16 | Time zone from their address | text | no |
| 17 | Tags describing this account | multi-select / list | no |
| 18 | One recent news item about this company | text | yes |
| 19 ★ | Which of our products fits best? | single-select (Product) | no |
| 20 | Decision-maker's title from the last email thread | text | no (email) |

*(These double as the seed for doc 7a's eval fixtures — each has a known expected shape.)*

---

## Data model (Prisma) — the AI column

```prisma
model AiColumn {              // NEW — an AI-instruction column (moved from doc 4b)
  id          String  @id @default(cuid())
  objectId    String
  name        String
  prompt      String            // the instruction, with {{field}} placeholders (4g.2)
  systemPromptVersion String    // our fixed system prompt version (4g.6 / provenance)
  outputType  String            // text | number | date | select | multiselect | list
  optionsRef  String?           // if outputType=select, which AttributeDef's options
  useWeb      Boolean @default(false) // allow the web agent (doc 7.7d)
  model       String  @default("auto") // auto | claude-haiku-4-5 | claude-sonnet-5 (4g.6)
  runCond     Json?             // only-if-empty | stale-past-TTL | low-confidence (4g.3)
  reviewMode  String  @default("review") // review (Suggest & review, 4g.8) | autowrite (4g.5)
  contextScope String @default("latest_call") // latest_call | all_interactions | emails | none (4g.1 step 5)
  // per-cell result writes to the record + a Provenance row (doc 7.9); a human edit pins the cell (4g.5)
}

model AiSuggestion {          // NEW — a pending Suggest-&-review proposal (4g.8)
  id          String   @id @default(cuid())
  workspaceId String
  aiColumnId  String            // which AI column produced it
  recordId    String            // the row/record it targets
  fieldId     String            // the field it would change
  currentJson Json?             // value at suggestion time (for Current → Suggested)
  suggestedJson Json            // the proposed value (cast to outputType)
  sourceJson  Json?             // source(s): call/email/web the AI used (click-through)
  model       String            // provenance (doc 7.9)
  promptVersion String
  status      String  @default("pending") // pending | accepted | edited | rejected | superseded
  actedBy     String?           // userId who accepted/edited/rejected
  actedAt     DateTime?
  createdAt   DateTime @default(now())
  @@index([workspaceId, status])
}
```

## Background jobs

- **Reuses H2/H3 from doc 7** — a Run-all/Run-empty enqueues per-cell runs on the doc-7 AI-field runner; **no new job type** is introduced here. Trigger: the ▶ button or Run-all. Params: batched, retry ×3, rate-limited (doc 7.7). Provenance written per cell (doc 7.9).
