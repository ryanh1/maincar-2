# Doc 7i — AI Fields & Columns

Part of the **AI Copilot** family — a **Surface**. See the map in [7 — AI Copilot](7-ai-copilot.md). This is the single home for the feature that was split across the old **Journey 7.6 (AI fields on a record)** and **[4g — AI Columns](4g-crm-ai-columns.md) (the table-native face)** — they are the **same feature** (a value the AI computes from a row's own data), so this doc owns the concept and [4g](4g-crm-ai-columns.md) owns the in-grid interactions.

**What it is, plainly.** An **AI field** is a field (or a table column) whose value the AI **computes from that record's own data** — its other fields, its notes, its call history — instead of a human typing it. Benchmarked on **Attio AI attributes** and **Clay's Claygent columns**.

**What it's for (your "I don't understand the use cases" question) — concrete use cases:**
- **Rolling account summary** — a live one-paragraph state of the account, updated as calls/emails/notes land.
- **Note summary** — a record's notes distilled into one field, kept current.
- **Classify** — "score this account A / B / C," "is this a real business?," set a **persona**.
- **Derive a fact** — "industry from the website," "seniority from the title."
- **Next step** — "the recommended next step from the last call."

The difference from **enrichment** ([7d](7d-enrichment.md)): enrichment fetches facts from **outside** sources; an AI field computes a value from the record's **own** data (though it *may* be allowed to search the web — a per-field toggle).

**Model** ([7 global rule](7-ai-copilot.md)): default **`claude-haiku-4-5`** for cheap high-volume fields (classify, derive), **`claude-sonnet-5`** for summary/judgment fields; super-admin can override; a one-off "draft the prompt with AI" uses `claude-sonnet-5`.

Under each journey: **Benchmark (beat this)** = the product to match. **Build docs** = the technical page.

---

## Journey 7i.1 — Add an AI field (config)

*As a rep, I want to add a field that runs an instruction I write on each record, so I can summarize or classify hundreds of records without leaving the table.*

1. **Entry point.** In the **Data-model editor**, or in a table's **`+` add-column menu → AI field** (the grid version, [4g.1](4g-crm-ai-columns.md)). A config panel slides in from the right (tab-navigable).
2. He sets: **name**, the **instruction** (the prompt, with `{{variables}}` from the record — a **✨ Draft with AI** button writes a starter prompt), the **output type** (short text / single-select from an existing field / number / yes-no), the **context scope** (latest call / all interactions / emails only / just this record's fields), whether it may **search the web**, the **model** (Auto), a **run condition** (only-if-empty / always), and the **review mode** (suggest-and-review / auto-write). **Save.**
- **Benchmark (beat this):** Attio — AI attributes [visual] — https://attio.com/blog/introducing-ai-attributes + [how it works] — https://attio.com/help/reference/managing-your-data/attributes/ai-attributes ; Clay — Claygent column [visual walkthrough] — https://www.arcade.software/guides/how-to-use-claygent-ai-research-in-clay + [how it works] — https://university.clay.com/lessons/enriching-with-claygent . **Build docs:** the `AiFieldDef` model (below); the grid interactions in [4g](4g-crm-ai-columns.md).

## Journey 7i.2 — Run an AI field (one cell, or the whole column)

*As a rep, I want to run the instruction on one record or a whole selection, so I apply it at any scale.*

1. Each AI cell has a **▶ play** button (run one); a column header has **Run on selection / Run whole column** (the grid version is [4g](4g-crm-ai-columns.md)). A bulk run is **background job H3** with a progress toast; values stream in, each with a provenance chip ([7k](7k-provenance.md)).
- **Build docs:** job H3; results stream into cells.

## Journey 7i.3 — Two starter kinds that keep themselves current

*As a rep, I want a field that stays summarized as things change, so I always see a current snapshot without updating it.*

Two built-in kinds beyond a one-off column:
- **Note summary** — summarizes a record's notes; kept current as notes change.
- **Rolling account summary** — a live one-paragraph account state, updated on every new call/email/note.
- **Benchmark (beat this):** Attio — AI attributes (auto-recalculating) — https://attio.com/help/reference/managing-your-data/attributes/ai-attributes .

## Journey 7i.4 — When an AI field recomputes (the trigger)

*As the workspace, I want AI fields to recompute on relevant change without re-paying on every unrelated edit.*

1. **On field creation** — a backfill run over existing records.
2. **On relevant new activity** for that record (a new note/call/email for a note- or account-summary) — via **job H3**, **debounced ~30–60s** (a burst of edits → one recompute, not ten). **Not** on unrelated changes, **not** on a fixed timer. *(This is the same "what counts as relevant activity?" question the decision engine's gate answers — [7c.12](7c-ai-decision-engine.md).)*
3. **The staleness cap (a safety net, not the trigger).** A per-field **max age** (`maxStalenessH`, nullable): if a value hasn't recomputed within that window **and** the record has activity the value doesn't reflect, H3's daily sweep forces one recompute. It exists so a *silently missed* trigger can't leave a value wrong forever. **Default: off (`null`) for note-summaries** (change-only value), **on at ~168h/7d for rolling account summaries** (read before calls/forecasts). Admin-settable per field. A cap **never** overrides a human pin.
4. **A human edit pins** the value and stops auto-recompute until he unpins.
- **Build docs:** job H3 (below); `AiFieldDef.recomputeOn` + `maxStalenessH`.

---

## Background jobs
- **H3 — Recompute AI fields.** Trigger: field creation (backfill) + relevant new activity, debounced ~30–60s. **Staleness sweep:** daily pg-boss cron (`0 4 * * *`, workspace tz) recomputes only records **both** past `maxStalenessH` **and** behind unreflected activity. pg-boss queue `ai-field-recompute`, `retryLimit: 2`, `singletonKey = recordId:attributeId` (event path + sweep can't double-run one field). Skips pinned values. `claude-haiku-4-5` default / `claude-sonnet-5` for summaries.

## Data model
```prisma
model AiFieldDef {            // NEW — Journey 7i (config; value lives in Record.valuesJson, backed by Provenance 7k)
  id            String  @id @default(cuid())
  attributeId   String        // -> AttributeDef (type = "ai")
  kind          String        // note_summary | account_summary | classify | derive | custom
  instructions  String        // the prompt (with {{variables}})
  contextScope  String @default("record") // record | latest_call | all_interactions | emails
  useWeb        Boolean @default(false)
  recomputeOn   String @default("activity") // activity | manual
  maxStalenessH Int?          // staleness-cap safety net; null=off. Seed: null note_summary, 168 account_summary.
}
```

## Cross-doc references preserved
Replaces the old **Journey 7.6**; **merges with [4g — AI Columns](4g-crm-ai-columns.md)** (this doc = the feature + config; 4g = the in-grid interactions). Related: provenance [7k](7k-provenance.md), enrichment [7d](7d-enrichment.md) (outside facts vs. computed values), the decision-engine gate [7c.12](7c-ai-decision-engine.md) (the same "relevant activity" logic).
