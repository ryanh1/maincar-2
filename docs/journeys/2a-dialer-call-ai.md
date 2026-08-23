# Doc 2a — Dialer: Call AI (recommended disposition, summary, extraction)

Split out of doc 2 so the **AI** parts of one call sit apart from the **manual / phone** parts. This doc holds:

- **Journey 2.4c** — the AI-recommended disposition (rep-facing).
- **Journey 2.4d** — its eval fixtures & pipeline (engineer-facing).
- **Journey 2.6** — the AI call summary (rep-facing).
- **Journey 2.7** — configure the summary/extraction templates (admin-facing), incl. the CRM auto-apply job.
- **Journey 2.7a** — default templates + restore (admin-facing).
- **Journey 2.7b** — pick which template a call uses, live (rep-facing).

**Journey numbers continue doc 2's scheme.** 2.6 and 2.7 keep their numbers (docs 5, 6, 7, 7b already link to "Journey 2.7"); the new journeys are 2.4c / 2.4d / 2.7a / 2.7b. **Data models** used here (`CallSummary`, `SummaryTemplate`, `ExtractionField`, `CallExtractedValue`, and the `predicted*` / `appliedTemplateId` fields on `Call`) live in **doc 2's schema**; this doc references them. Background jobs **C2 / C2b / C3** also live in doc 2 (the shared call pipeline).

**Model-default convention (your principle).** Every AI inference below names a **default model**, chosen for that call's mix of **speed, cost, and accuracy**. The **super-admin can change any of them on the backend** (your global edit) — the defaults are the starting point, not a lock-in. Third-party model choices (e.g. Deepgram) are named the same way in doc 2.

---

## Journey 2.4c — AI-recommended disposition

*As a rep, I want the app to pre-pick the likely disposition, so that I can confirm the outcome with a single keypress.*

**Entry point.** This runs on **every live conversation** (a call a human connected to), inside the same disposition bar as Journey 2.4 (doc 2). It does **nothing** on dead calls — those auto-apply deterministically (Journey 2.4 step 3).

### How the recommendation is produced — Background job C-DISP

- **Trigger:** fires (and re-fires) **during** the live call as new transcript arrives, and once more **on hang up** on the final transcript. It is a lightweight streaming inference, not a heavy post-call batch.
- **Input (data in) — transcript is *not* enough on its own (your question, answered below), so we feed:**
  1. the **live transcript so far** (job C2), plus
  2. the call's **non-transcript signals** — direction, ring time, duration-so-far, **AMD result**, who spoke last, which side hung up, and
  3. any **CRM context** we have — is this a known contact, and their **role/seniority**.
- **Model (default, super-admin can change):** **Claude Haiku 4.5.** *Why:* it runs **many times per call** and must be **fast and cheap**, and the rep always confirms, so moderate accuracy is fine. If the eval (Journey 2.4d) shows Haiku falls short, escalate to **Claude Sonnet 5**. The model is called with the workspace's **disposition list** and asked to return a **ranked list with a confidence** via JSON / tool-schema output (typed, not parsed from prose).
- **Output (data out):** a ranked disposition list + confidence. The top pick writes to `Call.predictedDispositionId`; the model + prompt version writes to `Call.predictionModel` (provenance). The ranked list is pushed to the browser over the same channel as the live transcript.
- **pgboss:** in-call inference is **streaming** (not queued). The on-hangup refresh runs on a `disposition-predict` queue, `retryLimit: 2`, low priority; if it fails, the rep's manual pick (Journey 2.4) still stands.

### The human-confirm steps (granular)

1. The recommended button in the bar gets a **filled accent color + a ring** and is **bound to Enter**. A tiny **"AI" glyph** marks it as a *suggestion*, not a fact.
2. **If the rep agrees** → he presses **Enter** (or clicks the button). The disposition saves and Save & Next advances — **one keypress**.
3. **If the rep disagrees** → he presses the **number key** of the right disposition, clicks any other button, or opens **More ▾**. **His pick wins and is saved; the AI pick is not applied.**
4. **If confidence is low** (below a set threshold) → we **do not** bind Enter and show **no** highlight, so a weak guess never nudges him. He picks entirely by hand (Journey 2.4).
5. **Nothing is ever auto-applied for a conversation.** The AI only *suggests*; a human always confirms. (Dead calls are the only auto-apply, and those are deterministic — Journey 2.4 step 3.)
6. **We record agreement.** Whether the rep **accepted or overrode** the suggestion is stored on the call. This becomes eval + training signal (Journey 2.4d).

### Is the transcript enough to detect this? (your question — no, not alone.)

Several dispositions can't be read from words:

- **No answer / left voicemail / busy** need **phone events + AMD**, not transcript.
- **Reached DM** (reached the actual decision maker) needs the person's **role**, which is usually **CRM context**, not what was said.
- **A polite brush-off vs genuine interest** can hinge on **tone / audio sentiment**, which plain text loses.

So the model input is transcript **+ phone signals + CRM context** (see the input list above). Even then some outcomes are genuinely ambiguous — which is exactly why this stays **suggest-then-confirm**, never auto-apply.

- **Primary benchmark — function (beat this):** Nooks — AI dialing / auto disposition — https://www.nooks.ai/ai-dialing-assistant ; Nooks — changing dispositions on a logged call [how it works] — https://support.nooks.ai/articles/3013057164-changing-dispositions-on-a-logged-call
- **Secondary — signals & sentiment:** Salesloft — disposition + sentiment — https://support.salesloft.com/hc/en-us/articles/360025661192-Manage-Dispositions-and-Sentiments
- **Build docs:** structured output via the model's JSON / tool schema; writes `Call.predictedDispositionId` + `Call.predictionModel` (doc 2 schema).

## Journey 2.4d — AI disposition eval fixtures & pipeline

*As the engineer building the disposition AI, I want an eval harness, so that I can raise its accuracy and stop regressions before reps rely on it.*

**Entry point.** The engineer runs this from the repo (a CLI command) and it also runs in CI. It is how we know the Journey 2.4c recommendation is good enough to highlight and bind to Enter.

### Definitions

- **Top-1 accuracy** — the share of calls where the model's **single best** disposition equals the disposition a human settled on. *(Did its first guess match?)*
- **Top-3 accuracy** — the share of calls where the human's disposition is **anywhere in the model's top 3**. *(A softer bar; the rep can still override in one key, so top-3 tells us the right answer was at least "close.")*

### Steps

1. **Generate the seed data — start tiny, grow only as needed (your call).** Before real dispositioned calls exist, the engineer **starts with ~20 synthetic labeled calls** — roughly **1–2 per disposition** — just enough to sanity-check the prompt and the harness end-to-end. **He adds more only when the numbers say to** (a disposition scores badly and has too few examples to trust), scaling up over time toward **~500 eventually** as the model and the disposition list mature. Each fixture is a **transcript + non-transcript signals** (duration, AMD, who hung up, CRM role) with the **correct disposition as its label**. **Generator model (default): Claude Opus 5** — offline batch, so pick the most realistic and varied; each fixture is **hand-spot-checked**.
2. **Freeze a held-out slice.** At the ~20-call start it is only ~5–6 calls; as the set grows toward 500, move to a **~70 / 30 split (~150 held out)**. Whatever the size, the held-out slice is **never** used for prompt tuning, so scores stay honest.
3. **Swap in real calls as they arrive.** Once reps are dispositioning real calls, **replace synthetic fixtures with real ones** (transcript + signals + the human's final disposition as ground truth, plus the accept/override signal from Journey 2.4c), keeping the set balanced. Real data is the goal; synthetic is only the cold-start.
4. **Run the eval.** Load fixtures → run the current model + prompt (the C-DISP model under test) → score **top-1 / top-3**, overall **and per-disposition** (a **confusion matrix**), so we see *which* dispositions it confuses (e.g. "Interested" vs "Callback").
5. **Act on the results — the engineer's loop (your question: what next?).** Based on where it fails:
   - **Two dispositions systematically confused** → sharpen their **definitions in the prompt** and add **few-shot examples** of the boundary.
   - **A whole disposition scores badly** → check the **input signals first** — often the miss is a *missing* signal (e.g. it can't separate "voicemail" from "no answer" without AMD), so **add the signal to the context**, not just reword the prompt.
   - **Everything mediocre** → try a **stronger backend model** (e.g. Haiku 4.5 → Sonnet 5, the super-admin lever) or restructure the output schema.
   Then **re-run** until the bar is met. This is the core loop.
6. **Gate deploys.** A change to the prompt/model ships **only if** top-1 ≥ the accepted bar (start target: **≥70 % top-1, ≥90 % top-3**, tuned with real data) on the frozen test set; otherwise it is **blocked** and the prior version stays live. *(With the tiny early set the percentages are noisy — treat them as directional; apply the formal gate once the set is large enough to trust, ~150+ calls.)*

### Pipeline (background job)

- **Trigger:** on every change to the prediction prompt/model, **and** nightly.
- **Runs in CI** against the frozen test set; writes the scorecard (top-1 / top-3 + confusion matrix) to the run log.
- **pgboss:** a `disposition-eval` queue, one job per run, `retryLimit: 2`, no concurrency (it is a batch, not per-user).
- **Provenance:** each accepted run records model + prompt version, so a regression traces to a specific change.

- **Benchmark (match this):** doc 7a — Copilot eval fixtures (same fixture + frozen-test-set discipline, here applied to disposition prediction).
- **Build docs:** internal eval harness; structured output via the model's JSON / tool schema.

## Journey 2.6 — Get the AI call summary

*As a rep, I want an automatic AI summary after each call, so that I capture the call without typing it up.*

**Summary and extraction are one feature, not two (your question).** They do **not** conflict — they are two *outputs* of the **same post-call pass (job C3)**, set up in **one editor (Journey 2.7)**: a **Summary Template** (the human-readable recap) and an **Extraction Field Set** (the structured CRM data). One transcript in → a narrative summary **and** typed fields out — plus **action items / next steps**, which are just another output of the same pass (they feed the next-step row, Journey 2.4 step 4, and later become tasks). This matches the benchmarks: **Gong** pairs Call Spotlight / briefs with its AI Data Extractor; **Salesloft Rhythm** turns one call into a summary *and* the action items it queues; **Nooks** produces a summary + auto-filled CRM fields + disposition in one post-call step; **Trellus** auto-summarizes and auto-fills the CRM after the call. So we keep them unified: **one config, one job, three outputs (summary, fields, next steps).**

**During vs after the call — what we infer where, and why (your question).**

| When | What runs | Why there |
|---|---|---|
| **During** (live, streaming) | live transcript (C2); **disposition recommendation** (C-DISP, Journey 2.4c); live coaching / battlecard cues **[LATER]** | Only useful **before hang-up** — the rep acts on them in the moment. **Speed beats accuracy**, and the rep confirms, so a rough guess is fine. Runs on the partial, un-diarized live transcript. |
| **After** (post-call, batch) | **summary + field extraction + action items** (C3) | They need the **whole, clean, speaker-labeled** transcript (C2b) — "who said the budget" requires diarization. They land in the **record, CRM, and reporting**, so **accuracy beats latency**, and they can't run mid-call because the conversation isn't finished. |

*Rule of thumb: infer **live** only what the rep uses **before hang-up**; infer **post-call** anything that lands in the record, the CRM, or reporting.*

1. **Entry / trigger.** He hangs up. **Background job C3** (doc 2) runs on the post-call high-accuracy transcript (C2b, with speaker labels), so the summary and the extracted fields are accurate. It appears within a few seconds — the rep did nothing to trigger it. **Model (default):** **Claude Sonnet 5** (doc 2 tech choices — once-per-call, accuracy matters, latency lenient).
2. **Where it shows (UI).** On the call record (Journey 2.9, doc 2), the AI summary is the **default view of the right column**, above the fold. A small segmented toggle at the top of that column switches **Summary | Transcript | Notes**. On wide screens the transcript still shows in the left column, so summary and transcript are visible together; on mobile they stack behind the same toggle.
3. **What the summary includes** (driven by the applied template — Journey 2.7): a short **Overview**, **Pain points**, **Next steps / action items**, and the **extracted structured fields** (e.g. budget, timeline, competitors) as a compact key–value list. Each line links to the transcript moment it came from (click-to-seek). **This is fully customizable — the sections and fields shown here are whatever the admin defined in Journey 2.7; nothing is hard-coded.**
4. **Regenerate is a low-profile control, because it is rarely used.** It is an **icon button (a circular-arrow ↻) in the summary column's header, or inside a "⋯" overflow menu** — not a big button eating prime space.
   - **On click:** a small confirm ("Regenerate the summary? Your manual field edits are kept.") → it **re-runs Background job C3** on the same post-call transcript. The summary area shows a **loading / shimmer state for the few seconds** it takes, then swaps in the new summary. Audio, transcript, and notes are untouched.
   - **Edits win over AI:** he can also edit any field by hand; a manual edit is marked and is **not** overwritten by a later regenerate.
   - **What it uses:** the template that was **applied to this call** (Journey 2.7b) + the super-admin model. Regenerate does not change the template inline — to run a *different* template he switches it first (Journey 2.7b), then regenerates.

- **Primary benchmark — the unified pattern (beat this):** **Salesloft Rhythm** — https://salesloft.com/platform/rhythm/ , and **Nooks** — https://www.nooks.ai/ . *Why these two: they best embody the exact thing benchmarked here — one post-call step that yields recap **+** CRM autofill **+** next actions, which is our whole "one feature" thesis. Trellus — https://www.trellus.ai/ — is a third example of the same.* **Honest caveat:** their **public docs are thin** (mostly marketing pages), so they anchor the *concept*, not pixel-level UI.
- **Secondary — best-documented reference for the output/UI:** **Gong — Call Spotlight** — https://www.gong.io/call-spotlight/ (+ AI Data Extractor, Journey 2.7). *Why: Gong has by far the most detailed public help docs and screenshots, so it is the most useful to copy for what the summary + fields should actually look like — even though Gong splits them across two features instead of unifying them.*
- **Build docs:** Deepgram — summarization — https://developers.deepgram.com/docs/summarization ; summary model default **Claude Sonnet 5** (doc 2 tech choices).

## Journey 2.7 — Configure AI summary & data-extraction templates

*As an admin, I want to configure what the AI writes and extracts from every call, so that each call produces the structured data we need.*

**Entry point.** **Settings → Intelligence → Summary & extraction templates.** This is where AI turns talk into structured CRM data. Designed after comparing Gong, Attio, Avoma, Momentum, Fireflies, Clari, and tl;dv.

**What the screen looks like.** A **two-pane layout**. **Left:** a list of templates — each row shows the name, a **"Default"** tag if it was seeded, and a **"⋯" row menu** (Rename, Duplicate, Delete, Set as org default). Above the list sits **"+ New template"** and, on the right, a **"⋯ More" menu** whose items include **"Restore default templates"** (Journey 2.7a). **Right (the editor):** two stacked cards for the selected template —

- **Summary Template card** — a list of **section rows**, each with a **drag handle (⠿)**, a **Title** field, an **instructions** box, a **format toggle** (Paragraph / Bullets), and a **length** picker (Short / Medium / Long); an **"+ Add section"** button at the bottom.
- **Extraction Field Set card** — a **table** of field rows (columns: Name, Type dropdown, Extraction prompt, Guidance, CRM mapping, Write-rule dropdown); an **"+ Add field"** button at the bottom.

The editor header carries **Preview** and **Publish** buttons on the right. He configures two objects:

1. **Summary Template** — ordered named **sections**. Per section: a **Title**, a **prompt / instructions**, a **format** (paragraph or bullets), and an optional **length** (short / medium / long). Example sections: Overview, Pain points, Next steps.
2. **Extraction Field Set** — the structured fields pulled onto the record and into the CRM. Per field:
   - **Field name** — the label shown on the record and in the CRM.
   - **Type** — yes/no, single-select, multi-select, number, date, range, short text, long text.
   - **Extraction prompt** in plain language — *"What budget did the buyer state?"*
   - **Guidance / example values** — for a picklist, define each option; for fuzzy concepts, give **5+ example sentences** to anchor the model, plus optional example output values.
   - **CRM mapping** — target object + field, with a **write rule**: confirm / write-if-empty / overwrite.
   - **Empty handling** — allow "not mentioned," so the AI never invents a value (stored as **null**, never `""` — doc 2 empty-value rule).
3. **Which template applies to which calls** — see **Journey 2.7b**. Short version: every call gets the **org default**, and the rep can **override live during the call**. (We deliberately did **not** build a conditional rules engine here — it was error-prone; see 2.7b.)
4. **Preview before publish — step by step (your ask: this was under-specified).**
   1. In the template editor, he clicks **Preview**.
   2. He picks a **sample of past calls** to run against — the editor defaults to the **5 most recent** matching calls; he can pick specific ones. If the workspace has **no past calls yet**, the editor offers a **built-in synthetic sample call**, so preview works on day one.
   3. The app runs the **draft** template through a **dry run of C3** (same model, same prompts). **Nothing is saved and no CRM writes happen.**
   4. Results show **side by side**: the produced **summary sections** and the **extracted field values**, per sample call, each value linked to the transcript moment (so he can sanity-check where it came from).
   5. He **tweaks** a prompt or field and clicks **Preview again** — as many times as he likes.
   6. When happy, he clicks **Publish**; only then does the template become live for new calls. A slow dry run shows a spinner; preview runs are throttled to a few at a time.

*Why post-call, not live: accurate field extraction needs clean text and speaker labels. Live transcription (C2) drives in-call cues; the extraction + summary pass runs on the post-call high-accuracy transcript (C2b → C3).*

### Background job C3b — apply extracted values to the CRM (your question: does config cover auto-capture?)

The config in this journey defines **what** to pull and **where** it maps; **C3b does the actual writing.** So yes — auto-capture is a real background job, described here:

- **Trigger:** fires right after **C3** writes the `CallExtractedValue` rows for a call (same chain).
- **Steps, per extracted value that has a CRM mapping and a non-null value:**
  1. **Resolve the target record** — the call's **linked person/deal**. If the call has **no linked record**, we **do not create one** from extraction (that would breed junk); the value stays on the call and is queued for the copilot review UI (doc 7).
  2. **Apply the write rule** (from step 2 above):
     - **write-if-empty** → write only if the CRM field is currently **null** (doc 2 empty-value rule).
     - **overwrite** → always write.
     - **confirm** → do **not** write automatically; create a **review item** a human accepts/rejects (doc 7).
  3. **Multi-value fields** → **append + dedupe** new options rather than replace (unless the rule is overwrite).
  4. **Write provenance** on the value: source call, model, template, timestamp.
- **Updates vs upserts (your question):** C3b does **field-level updates** on existing records. It **never creates** a Person/Deal from extraction — record creation stays an explicit human action. It is **idempotent** — re-running the same call writes each field once (guard on call + field + value).
- **pgboss:** `crm-apply` queue, `retryLimit: 3`, idempotent; runs after C3 in the same chain.
- *Note:* CRM objects arrive in doc 4; until then C3b writes to the call record's own extracted-values store and the mappings sit dormant.

**Benchmarks — my favorite per dimension (your question).** We aim to **beat them all**, but the two to study hardest, one per dimension:

- **Primary — builder UX / schema picker:** **Attio — insight templates** (cleanest field builder) — https://attio.com/help/reference/productivity-collaborating/call-intelligence/create-insight-templates-for-call-recordings . *My favorite for the config experience.*
- **Primary — extraction output quality:** **Gong — AI Data Extractor** — https://help.gong.io/docs/ai-data-extractor . *My favorite for the result.*
- **Secondary (beat too, references):** Avoma — customize smart categories — https://help.avoma.com/how-to-customize-smart-categories ; Momentum, Fireflies, Clari, tl;dv.
- **Build docs:** structured output via the model's JSON / tool schema; the AI **model is chosen by the super-admin on the backend** — default **Claude Sonnet 5** (doc 2 tech choices).

## Journey 2.7a — Default templates (seed + restore)

*As an admin, I want sensible default templates on day one, so that summaries work before I configure anything.*

**Should we ship defaults? Yes.** A brand-new workspace must produce useful summaries before the admin touches anything, so we **seed** one default Summary Template and one default Extraction Field Set on workspace creation. This all lives on the same **Settings → Intelligence → Summary & extraction templates** screen described in Journey 2.7.

1. **Entry.** He opens that screen and already sees the seeded defaults in the **left list**, each tagged **"Default."**
2. **The default Summary Template** — sections:
   - **Overview** (short paragraph) — what the call was and how it went.
   - **Pain points** (bullets) — problems the buyer raised.
   - **Next steps / action items** (bullets) — what was agreed.
   - **Objections / risks** (bullets) — anything that could stall the deal.
3. **The default Extraction Field Set** — common B2B sales fields, each mapped to the CRM with **write-if-empty**:
   - **Budget** (range/number), **Timeline** (date/short text), **Decision maker identified?** (yes/no + short text), **Competitors mentioned** (multi-select/long text), **Next step agreed** (short text), **Call sentiment** (single-select: positive / neutral / negative).
4. **Edit a default (edge case).** Defaults are **fully editable** in the right-pane editor — rename, reorder sections, change prompts. Editing one just writes that row; we **never overwrite user edits** on later releases. An edited default keeps working as the applied template.
5. **Delete a default (edge case).** Via the row's **"⋯" menu → Delete**. Allowed — but we never leave calls with **no** template:
   - Deleting the **org default** pops a warning and makes him **pick a new default** first.
   - If every template is deleted, the app **falls back to a built-in hidden default** so summaries never silently stop.
6. **Restore defaults — where it is and what it looks like (your example).**
   - **Where:** the **"⋯ More" menu at the top-right** of the templates screen → **"Restore default templates."**
   - **On click:** a **confirm modal** opens titled *"Restore default templates?"* It **lists exactly what will be re-added** — *"Default Summary Template"* and *"Default Field Set"* — and states plainly: **"These are added as new copies. Your existing templates are not changed or deleted."** Buttons: **Cancel** / **Restore**.
   - **On Restore:** the built-in defaults are re-seeded as **new rows** (named e.g. *"Default Summary Template (restored)"* if the original name is taken), they appear in the left list tagged **"Default,"** and a **toast** confirms *"Restored 2 default templates."* Nothing he customized is touched.
   - Backed by the `origin = "seed" | "user"` marker on the template models (doc 2 schema).
7. **New defaults we ship later** are **backfilled** to existing workspaces as **additional** templates, never overwrites — the same "seed idempotently, never overwrite user edits, backfill on new defaults" rule as default dispositions (doc 2) and standard objects (doc 4).

- **Benchmark (match this):** Avoma — smart-category defaults — https://help.avoma.com/how-to-customize-smart-categories
- **Build docs:** idempotent seed on workspace creation (doc 4's seed/backfill pattern); `origin` marker on `SummaryTemplate` / `ExtractionField` (doc 2 schema).

## Journey 2.7b — Pick which template a call uses (live)

*As a rep, I want to set (and change) which summary/extraction template a call uses right in the call form, so that the right template runs without a fragile rules engine.*

**Entry point.** A small **"Summary template" picker** sits in the **call form, just above (or beside) the notes box**, on every call. It renders as a compact dropdown labeled **"Summary template: Default ▾"**; opening it lists the workspace's templates with the active one checked.

1. **When a call starts,** the picker is preset to the **org default** template, so the rep sees which template is active without opening Settings. Changing it updates the label immediately (e.g. **"Summary template: Renewal call ▾"**).
2. **He can change it live** at any point during the call by choosing another template from the dropdown.
3. **What actually runs:** because summary/extraction run **post-call** (C3 on the C2b transcript), the template that runs is the one **selected at hang up**. We store it as `Call.appliedTemplateId`.
4. **Edge cases (your ask — including toggling midway):**
   - **Never touched** → the org default runs.
   - **Toggled midway, then back** → **last selection before hang up wins** (a mid-call toggle is safe; nothing has run yet).
   - **Toggled after hang up** (from the call record) → nothing re-runs on its own; the rep clicks **Regenerate** (Journey 2.6) to re-run C3 with the newly selected template.
   - **The selected template is deleted before hang up** → fall back to the **org default** (never null).
5. **Why a live picker instead of a rules engine (your concern that 2.7.3 was messy/error-prone).** A conditional engine ("apply template X when direction=outbound and stage=Proposal and …") is powerful but **error-prone** — overlapping rules, precedence, and silent mis-selection are exactly the mess you flagged. So the primary mechanism is the **simple, explicit** pair: **org default + live per-call override.** A conditional auto-select engine is **[LATER]**, an optional advanced layer on top — never the only path.

- **Benchmark (loose):** Gong / Avoma — choosing a template/category per recording (the picker pattern).
- **Build docs:** `Call.appliedTemplateId` (doc 2 schema); the picker reads the workspace's templates and writes the selection on the call.
