# Doc 7d — Enrichment

Part of the **AI Copilot** family (head: [7 — AI Copilot](7-ai-copilot.md); the decision engine that *calls* enrichment is [7c](7c-ai-decision-engine.md); the table-native face is [4g — AI Columns](4g-crm-ai-columns.md); provenance is [7k](7k-provenance.md); eval fixtures are [7a](7a-copilot-eval-fixtures.md)).

**What this doc covers.** Everything about **enrichment** — filling in a record's missing facts (a company's industry and size, a person's mobile and title) from outside data sources, and the deeper "research" agents built on the same plumbing (signal watching, web research with citations, list building, deep research-to-sell). It was **split out of the old Journey 7.7** because it grew into its own feature with its own config CRUD, its own usage journeys, and its own monitoring.

**Two halves, like every config-plus-usage feature (guidance point 1d).** *Config* journeys (7d.1–7d.8) are about setting enrichment up: sources, keys, the per-field waterfall, BYO steps. *Usage* journeys (7d.9–7d.20) are about consuming it: auto-enrich on create, the manual buttons, bulk, reverse, the research agents. *Monitoring* journeys (7d.21–7d.24) are about watching cost and accuracy. The **research agents** (signal / web / list-building / deep-research) are 7d.16–7d.20.

**Where AI inference is used, the model is named** (guidance point 17); all models are super-admin-set and swappable ([7 global rule](7-ai-copilot.md)).

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the technical page.

---

## The shape of enrichment (read this first)

- **A source** is one place data comes from — a third-party provider (People Data Labs, Apollo, Bright Data), *or* one you bring (a REST endpoint, an AI research step, a formula).
- **A waterfall** is a **per-field ordered list of sources**: for "mobile number," try source A; only if it misses, try B; then C. First confident hit wins and is cited. (Single-provider mobile coverage is ~40–60%; a 2–3 source waterfall reaches ~80–90%.) This is why the waterfall exists: the expensive source only runs on what cheaper ones miss.
- **A run condition** decides whether a source runs at all on a given cell: *only if empty · only if stale past a TTL · only if low confidence · always.* This is what stops us re-paying for data we already have.
- **Provenance** ([7k](7k-provenance.md)) records, per value: which source answered, its confidence, the fetch date, and the run id — so any value can be checked, re-verified, or rejected.

**Benchmark (beat this):** Clay — waterfall enrichment (the per-field, first-hit-wins model) — https://www.clay.com/guides/waterfall-enrichment . **Build docs:** internal — provider adapters behind one interface; the `EnrichmentSource` + `EnrichmentRun` models (end of doc).

---

# Config journeys

## Journey 7d.1 — Find the enrichment settings and turn it on/off

*As an admin, I want one place to turn enrichment on or off — globally or per object — so that I control whether the app spends money reaching outside data.*

1. **Entry point.** **Settings → Intelligence → Enrichment.** (Left nav: Settings, then the "Intelligence" group, then "Enrichment" — the same group that holds Skills and AI permissions, [7c.27](7c-ai-decision-engine.md).)
2. The page opens on an **overview**: a master **on/off** toggle at the top, then a **per-object** list (Company · Person · Deal…) each with its own on/off, then tabs for **Sources**, **Keys**, **Waterfalls**, **Monitoring**.
   ```
   ┌──────────── Enrichment ────────────┐
   │ Enrichment      [ ●  On ]          │  ← master
   │ ─────────────────────────────────  │
   │ Auto-enrich by object              │
   │   Company   [ ● On ]   ▸ waterfall │
   │   Person    [ ● On ]   ▸ waterfall │
   │   Deal      [ ○ Off]               │
   │ ─────────────────────────────────  │
   │ [ Sources ] [ Keys ] [ Waterfalls ]│
   │ [ Monitoring ]                     │
   └────────────────────────────────────┘
   ```
3. **If master is Off (then):** no auto-enrich runs anywhere, and the manual "Enrich" buttons ([7d.11](#journey-7d11--manual-enrich--where-every-button-is)) show a tooltip "Enrichment is off — turn it on in Settings." **If a per-object toggle is Off:** auto-enrich skips that object but manual buttons still work.
- **Benchmark (beat this):** Clay — table management settings (auto-run on/off, "keep existing results") [how it works] — https://university.clay.com/docs/table-management-settings ; Clay — enrichments overview [visual] — https://university.clay.com/docs/enrichments . **Build docs:** internal — `Workspace.enrichmentEnabled` + per-`ObjectDef` flag.

## Journey 7d.2 — CRUD a data source (a provider)

*As an admin, I want to add, view, edit, and remove the providers we pull data from, so that the waterfall has sources to draw on.*

Four distinct journeys (guidance point 1a — "CRUD" is not one journey):

1. **Read (list) the sources.** Settings → Enrichment → **Sources** shows a table: **name · type** (built-in provider / HTTP / AI agent / formula) · **status** (connected / needs key / disabled) · **cost per successful enrichment** · **rolling match-rate** ([7d.23](#journey-7d23--accuracy-monitoring--is-a-source-still-good)). Built-in providers (PDL, Apollo, Bright Data, a phone/email verifier) ship pre-listed but **disconnected until a key is added** (7d.3).
2. **Create (connect) a built-in provider.** Click **+ Add source → pick a provider**; a right-side panel asks for the **key mode** (our managed key, or bring-your-own — 7d.3) and any provider options; **Save** flips it to "connected." A BYO source (HTTP / AI agent / formula) is created in 7d.5–7d.7.
3. **Update a source.** Row **⋯ → Edit**: change key mode, rename, toggle enabled, set a per-source default run condition.
4. **Delete a source.** Row **⋯ → Remove**. **If the source is used in any waterfall (then):** a confirm lists which fields' waterfalls reference it and offers "remove from those waterfalls too" — we never leave a dangling reference (guidance point 9).
- **Benchmark (beat this):** Clay — the integrations/provider catalogue [how it works: one page per provider, each with its inputs and outputs] — https://university.clay.com/docs ; Clay — enrichments integration overview — https://university.clay.com/docs/clay-enrichments-integration-overview . **Build docs:** `EnrichmentSource` model.

## Journey 7d.3 — Manage keys: ours or yours (CRUD)

*As a cost- or compliance-sensitive admin, I want to bring my own provider keys so I pay providers directly at native rates and keep data on my contracts — or use the app's managed keys for zero setup.*

**The choice (both supported).** **Our managed keys** by default (usage-billed through the app, zero setup). **Bring-your-own-key (BYOK) per provider** so you pay the provider directly (often dramatically cheaper for AI steps) and stay on your own data-processing agreement.

1. **Read (list) keys.** Settings → Enrichment → **Keys**: a table of **provider · key mode (managed / BYOK) · status (valid / invalid / missing) · last verified**.
2. **Create/Update a BYOK key.** Row **Add key** → a field for the secret (masked; **entered by you, never shown back** — [security rule, we never ask you to paste a secret into an unsafe field]) → **Test** runs a cheap validation call → **Save** (encrypted at rest, `authRef` on the source). **If Test fails (then):** the row shows "invalid" and auto-enrich falls back to the managed key for that provider if one exists, else skips the source.
3. **Delete a key.** Row **⋯ → Remove key** → the source reverts to managed (if available) or "needs key."
4. Every list/table always shows **cost per successful enrichment** for the active key mode, so the tradeoff of BYOK-vs-managed is visible where you choose it.
- **Benchmark (beat this):** Clay — HTTP API + BYOK — https://university.clay.com/docs/http-api-integration-overview . **Build docs:** encrypted `authRef`; `EnrichmentSource.byok`.

## Journey 7d.4 — Build a per-field waterfall (CRUD)

*As an admin, I want to stack sources per field in priority order, so the cheap source runs first and the expensive one only runs on what's missing.*

1. **Entry point.** Settings → Enrichment → **Waterfalls** → pick an object (Company / Person) → pick a field (e.g. **Mobile**). Or from a table, a column header **⋯ → Edit enrichment** jumps straight here.
2. **Read.** The waterfall editor shows the ordered steps for that field:
   ```
   ┌─────── Waterfall: Person · Mobile ───────┐
   │ Run condition:  ( Only if empty ▾ )      │
   │ 1. People Data Labs      ~$0.08  71% ↑↓ ✕│
   │ 2. Apollo                ~$0.03  54% ↑↓ ✕│
   │ 3. AI research step      ~$0.01  38% ↑↓ ✕│
   │ [ + Add step ]                           │
   │ Allow only: [—]   Deny: [ Provider X ]   │
   │ Hard-block fallthrough: [ ]  (7d.15)     │
   │ [ Dry-run on 10 records ]     [ Save ]   │
   └──────────────────────────────────────────┘
   ```
3. **Create/Update.** **+ Add step** (a built-in provider or a BYO step), **drag to reorder** (order = accuracy → cost → coverage), set the **run condition** (only-if-empty default), set **allow/deny lists** (per-field: only these sources, or never these). **Dry-run on 10 records** samples real records and shows what each step *would* return + cost, **without writing** — so you tune before you spend.
4. **Delete a step** with the row **✕**; **delete the whole waterfall** reverts the field to "no enrichment."
- **Benchmark (beat this):** Clay — waterfalls — https://www.clay.com/guides/waterfall-enrichment . **Build docs:** `EnrichmentSource.fieldChains` (per-field ordered steps + allow/deny).

## Journey 7d.5 — BYO source: a custom HTTP endpoint (CRUD)

*As an admin with a proprietary or internal database, I want to add my own REST endpoint as a waterfall step, so our own data becomes a first-class source.*

1. **Entry.** Sources → **+ Add source → Custom HTTP.**
2. **Create/Update** in a panel: **URL + method**, **auth** (header / bearer / basic — the secret stored encrypted like a key, 7d.3), a **request template** (map `{{record.domain}}` into the query/body), and a **response mapping** (JSON path → our field, e.g. `$.company.industry → Company.industry`). A **Test** button calls it with a sample record and shows the mapped result.
3. **Read/Delete** like any source (7d.2). It then appears as a selectable step in any waterfall (7d.4).
- **Benchmark (beat this):** Clay — HTTP API integration — https://university.clay.com/docs/http-api-integration-overview . **Build docs:** `EnrichmentSource.kind = "http"` + mapping JSON.

## Journey 7d.6 — BYO source: an AI research step (our Claygent equivalent) (CRUD)

*As an admin, I want a waterfall step that is an AI web-research agent, so a field with no provider coverage can still be found and cited.*

1. **Entry.** Sources → **+ Add source → AI research step.**
2. **Create/Update:** name it, write the **instruction** ("Find {{person.name}}'s current job title at {{company.name}}; cite the source"), pick the **output field type**, and set the **no-citation-no-write** guardrail (on by default — the agent must attach a source URL or it writes nothing, [7d.17](#journey-7d17--web-research-agent-with-citations)). **Model: `claude-haiku-4-5`** for cheap high-volume steps by default (waterfall steps run at scale, and this runs last on the residual), upgradeable to `claude-sonnet-5` per step for hard fields — chosen for cost since it's the fallback tier, accuracy guarded by the citation requirement.
3. **Read/Delete** like any source; appears as a waterfall step (usually last, as the residual catch-all).
- **Benchmark (beat this):** Clay — Claygent Builder (build, test, deploy an agent as a source) [how it works] — https://university.clay.com/docs/claygent-builder ; the guided version [visual walkthrough] — https://university.clay.com/lessons/enriching-with-claygent . **Build docs:** `EnrichmentSource.kind = "agent"`; runs on the durable runner (job H2).

## Journey 7d.7 — BYO source: a formula / lookup step (CRUD)

*As an admin, I want a deterministic step (a formula or a lookup table) in the waterfall, so cheap known transforms run before any paid source.*

1. **Entry.** Sources → **+ Add source → Formula.** **Create/Update:** a formula over the record's fields (normalize a domain, derive a region from a country, look up a value in an uploaded CSV). No model, no cost. **Read/Delete** like any source.
- **Benchmark (beat this):** Clay — Functions (formula columns) [how it works] — https://university.clay.com/docs/functions ; Clay — formatters overview — https://university.clay.com/docs/clay-formatters-integration-overview . **Build docs:** `EnrichmentSource.kind = "formula"`.

---

# Usage journeys

## Journey 7d.8 — Fields we return (reference)

*As a rep, I want to know what enrichment can fill so I know what to expect.*

- **Company:** domain, industry, employee count, revenue, funding, location, description, **logo** (7d.15), tech stack, socials, **DBA/known-as name** ([7b.11](7b-copilot-automations.md)).
- **Person:** name, **preferred/nickname** ([7b.10](7b-copilot-automations.md)), title/seniority, **persona** (decision_maker / gatekeeper / champion / influencer / user — classified per [7d.8](7d-enrichment.md)), job history, **verified work email**, **mobile**, LinkedIn URL, **location** (so the rep knows if it's a real target in their territory before spending a dial).

## Journey 7d.9 — Auto-enrich on create (background job)

*As a rep, I want a new company or person to fill itself in the moment it's created, so I'm not staring at a blank record.*

1. **Trigger.** A `Record.created` event for an enrichment-enabled object (7d.1).
2. **Job H2 — Enrich.** pg-boss queue `enrich`, `singletonKey = recordId:reason` (so create + add-to-list can't double-run one record), `retryLimit: 3`, backoff (providers are rate-limited). Steps: for each enrichable field, run its waterfall (7d.4) honoring the run condition → first confident hit wins → **cast + validate** (email verify, phone → E.164, revenue → number, URL normalize) → write with a **Provenance** row (7.9). A new **Company** seeds from its **domain**; a new **Person** from their **email**.
3. A subtle **"enriched" chip** marks auto-filled cells; a **human edit pins** the field (7.9) so future auto-enrich won't overwrite it.
- **Benchmark (beat this):** Clay — auto-run on rows added/edited, plus the "only run if" condition [how it works] — https://university.clay.com/docs/table-management-settings . **Build docs:** job H2; `EnrichmentRun`.

## Journey 7d.10 — Auto-enrich on add-to-list (background job)

*As a rep, when I drop records into a working list, I want them enriched so the list is workable.* — Same **job H2**, triggered by `Record.addedToList`; same waterfall, run conditions, and provenance. **If a record was enriched recently (then):** the "only if empty / not stale" run conditions skip fields already filled — we don't re-pay. **Build docs:** job H2, `trigger = "list"`.

## Journey 7d.11 — Manual enrich — where every button is

*As a rep, I want a one-click "find this" exactly where I notice something's missing, so I never leave my flow to hunt for a number.*

Placement is the whole point of this journey (guidance point 1e). Every surface where a rep sees a gap gets an affordance — small, out of the way, but findable:

1. **In a table / list view.**
   - **Per row:** a small **✨ Enrich** icon-button appears on row hover at the **far-right actions cell** (next to the row's ⋯ menu). Tooltip: "Enrich this record."
   - **Per empty cell:** an empty phone/email/LinkedIn cell shows a faint **"find" magnifier icon** on hover, inside the cell at the right edge. One click requests just that channel (the exact ask — a mobile, not a blanket re-enrich).
2. **On a record page / drawer.**
   - **Header:** a **✨ Enrich** text-button in the record header's action row (next to Edit).
   - **Per empty field:** each empty field (phone / email / LinkedIn / title) shows a small **"find" link/icon** on the right of the field row.
3. **On the live-call screen + copilot rail:** a **"Find a better number/email"** button in the rail, for mid-call gaps ([7c.1](7c-ai-decision-engine.md) can also propose this).
4. **Bulk action bar:** with rows selected, the bar shows **Enrich** (with a channel dropdown: mobile / email / all).
5. **Chat / a skill:** "find the VP's mobile" ([7f skills](7f-skills.md)).
- **Design balance:** icons are faint until hover (out of the way), grouped at consistent edges (findable), and each targets a **specific channel** so the rep asks for exactly the missing thing. **Benchmark (beat this):** Apollo / Clay Chrome-extension per-row enrich buttons — https://university.clay.com/docs/clay-chrome-extensions .

## Journey 7d.12 — Enrich a whole column at once (bulk)

*As a rep, I want to fill every empty mobile down a column in one click, so I prep a whole list fast.*

1. **Entry.** A table column header **⋯ → "Enrich empty in this column."**
2. Runs **job H2** over only the empty cells (honoring run conditions), as a background job with a **progress toast** ("Enriching 42 of 300…"); values stream in with their provenance chips. He keeps working.
3. **On a selection** (rows, or a whole list) the bulk bar's **Enrich** does the same over the selection.
- This is the list-view companion to the per-cell "find this" (7d.11). **Note:** this is the same "run an instruction over many rows" pattern as an **AI column** ([4g](4g-crm-ai-columns.md)) and a **skill run** ([7f](7f-skills.md)) — enrichment is just the built-in case. **Build docs:** job H2, batched.

## Journey 7d.13 — Reverse enrichment (I know attributes but not the website)

*As a rep, I have a person's email or a company name and city but no domain — I want the app to resolve the canonical company first, then enrich.*

1. **Trigger.** Any enrich request (7d.9–7d.12) where the seed field (domain/email) is missing but other attributes exist.
2. **Steps.** Seed from what we have — a person's **email domain**, a **LinkedIn URL**, or **company name + location** — resolve the **canonical domain first** (a resolve step in the waterfall), then run the normal per-field waterfall against it. **If two companies match (then):** surface "we think this is X — confirm?" at medium confidence rather than guessing (identity-confirm rule, [7d.20](#journey-7d20--deep-research-to-sell-bulk--how-it-relates-to-ai-columns)).
- **Build docs:** a "resolve domain" step type; feeds the same H2.

## Journey 7d.14 — Array fan-out vs. composite cells (the "why not composite cells?" answer)

*As a rep, when a source returns a list — the five contacts at a company — I want them as real records I can call and email, shown neatly on the parent.*

**Your question, answered.** These are two different concepts that work together:
- **A composite cell** ([4f](4f-crm-composite-cells.md)) *displays* several values in one cell (a vertical stack of chips). It is a **view** concern — it shows data, it doesn't create records.
- **Array fan-out** *creates* real child records. When "contacts at company" returns five people, you want five actual **Person** records (so you can dial them, email them, set personas, run loops on them) — not five strings trapped in one cell.

So the design uses **both**: fan-out **creates** the child Person records (an explicit "write-to-related-object" step in the source's mapping), and the parent Company row then **displays** them via a **vertical composite cell** ([4f](4f-crm-composite-cells.md)) — best of both. A pure array of scalar strings with no need to act on them individually (e.g. a list of technologies) stays as a **multi-value cell**, no fan-out.

1. **Trigger.** A waterfall step whose response is an array and whose mapping targets a related object.
2. **Steps.** For each array item: **cast + validate**, **dedupe** against existing children (diminutive-aware, [5.3b]), **upsert** a child record, link it to the parent, write provenance. The parent's composite column then renders them.
- **Build docs:** a "write-to-related-object" mapping type; reuses upsert (doc 8) + composite rendering (4f).

## Journey 7d.15 — Company logos (and the face-photo stance)

*As a rep, I want company logos so my lists are scannable — but I don't want creepy scraped face photos.*

1. **Company logos: yes.** Low-risk and useful. Sourced from the firmographic providers (which return a logo URL) or Clearbit-style logo endpoints; stored as a URL on the Company, rendered as the record avatar and in list rows. **If no logo is found (then):** fall back to a generated monogram (initials on a color from the domain hash).
2. **Personal face photos: no by default.** A scraped face is GDPR biometric-adjacent (Clearview drew a €20M fine), unreliable, and creepy. Person avatars are **monograms** by default. If ever offered: opt-in only, consented/professional sources only, never raw face scraping.
- **Build docs:** `Company.logoUrl`; monogram fallback component.

## Journey 7d.16 — Signal research agent (hiring / funding / job-change)

*As a rep, I want the app to watch my accounts for buying signals and tell me when to strike, so I reach out while budget is fresh.*

1. **Config (where to turn it on).** Settings → Enrichment → the **Signals** section: which accounts to watch (a list / a saved view), which signals (hiring / funding / job-change), and the schedule. Per-rep or per-workspace.
2. **The job.** **Job H4 — Signal research.** pg-boss cron (default daily, `0 6 * * *` workspace tz) + on-click. For each watched account it runs web-research queries, looks for **hiring / funding / job-change** signals, and writes a **dated, cited** signal. **Model: `claude-haiku-4-5`** for the scan (high volume, cheap), escalating to `claude-sonnet-5` only to summarize a confirmed hit.
3. **Where it shows (usage).** As **timeline entries** on the account (doc 6 timeline) and a **"Signals" chip** on the record; a **digest** surfaces in the copilot rail / the [7c away-digest](7c-ai-decision-engine.md) ("3 accounts had funding news this week").
4. **Four objectives it serves** (why a rep cares): (a) **timely outreach** — "Acme raised a Series B" → call now; (b) **prioritize the day** — the morning digest ranks new-signal accounts to the top; (c) **re-engage a cold account** — your champion changed jobs → follow them or find the replacement; (d) **expansion timing** — a customer is hiring for the team you sell to → push expansion.
- **Benchmark (beat this):** UserGems — champion / job-change tracking — https://www.usergems.com ; Common Room — signal capture — https://www.commonroom.io . **Build docs:** job H4; `EnrichmentRun.kind = "signals"`; feeds the 7c engine.

## Journey 7d.17 — Web research agent with citations

*As a rep, I want to fill a fact the providers missed straight from the web, with a link I can check, so I trust it.*

1. **Entry (usage).** On any record, an **"Enrich from the web"** action (record header ⋯ menu, or a chat request); or as a waterfall step (7d.6).
2. **Steps.** The web agent runs research queries and, under the **no-citation-no-write** guardrail, writes each value **only with a citation URL**. The rep sees the value + a **source chip** to open the cited page. **Model: `claude-haiku-4-5`** default (volume/cost), `claude-sonnet-5` for hard research.
3. **Four objectives:** (a) fill a firmographic providers missed (employee count, HQ) from the company site; (b) verify a title before a call ("is she still VP of Sales?") with a link; (c) pull a recent fact for personalization ("their new product launch"); (d) research an unknown company you only have a name for (resolve domain, then enrich).
- **Benchmark (beat this):** Clay — Claygent as a web scraper/researcher [visual walkthrough] — https://university.clay.com/lessons/claygent-ai-web-scraper-limitless-research ; Clay — Perplexity integration [how it works: restricting citations to an allow-list of domains] — https://university.clay.com/docs/perplexity-integration-overview . **Build docs:** the web-fetch/search tools (doc 8); durable runner (H5).

## Journey 7d.18 — AI list building (sourcing brand-new records)

*As a rep, I want to describe an ideal customer and have the app find brand-new people/companies into a list, so I open a territory without buying a static list.*

1. **Entry (where it lives).** In chat ("build a list of…"), **or** a **"Build a list"** action on the **Lists** page (top-right, next to "New list"). A panel takes plain words or firmographic filters.
2. **Steps.** The agent **sources brand-new** people/companies into a **new list** (doc 4) — *finding* records, distinct from *enriching* ones you have. He **reviews the sourced rows (accept/reject)** before they're added; accepted rows then auto-enrich (7d.9). **If the run would exceed a credit cap (then):** it shows the estimated cost and asks to confirm before sourcing (7d.21).
3. **Four objectives:** open a territory ("SaaS, 50–200 employees, Texas, using Salesforce"); a persona list ("VPs of Sales at Series-B fintechs"); look-alikes ("companies like my last 3 closed-won"); a trigger list ("raised funding in the last 90 days in my ICP").
- **Benchmark (beat this):** Clay — Find Companies [how it works: the filter set] — https://university.clay.com/docs/find-companies ; Clay — Find People — https://university.clay.com/docs/find-people-overview ; Clay — Sources (every way a table gets seeded) — https://university.clay.com/docs/sources ; the guided version [visual walkthrough] — https://university.clay.com/lessons/finding-companies-in-clay . **Build docs:** a "source records" agent → new `List`; accept/reject gate ([7c.16](7c-ai-decision-engine.md)).

## Journey 7d.19 — Deep research "to sell" (per record)

*As a rep, before a call I want a cited brief and the angles to open with, pulled from far more sources than a data provider reads.*

1. **Entry.** On one record: **Actions → Deep research** (or chat: "research Dana before my 2pm").
2. **Sources it reads** (where available): the company **website** (About / History / Team / leadership pages), **LinkedIn** job history + recent posts (via licensed/public sources, 7d.25), **Twitter/X**, recent **press releases**, **YouTube interviews**, and general web — all through the **web agent (7d.17)**, so "research anything" and "research to sell" share one engine.
3. **What it returns.** A short **cited** brief + a list of **buying signals** (recent funding, hiring for your team, a leadership change, a public pain point, a shared connection, something said in an interview) — each **dated and linked** (no-citation-no-write). It posts to the account timeline + a "Signals" chip.
4. **Customizable + on/off.** The prompt that decides *what counts as a good signal* is a **skill** ([7f](7f-skills.md)) the rep can edit (his ICP, his wedge) and toggle. **Model: `claude-sonnet-5`** (this is the high-value, low-volume, judgment-heavy case — quality over cost).
5. **Edge cases (If X then Y).** *No web presence* → return **"not found," low confidence, never a hallucinated bio.** *Wrong-person match (common name)* → require multi-signal identity confirmation (email domain ↔ company ↔ name ↔ location) before writing; surface "we think this is X — confirm?" at medium confidence. *Regulated/healthcare target* → a config disables web/social mining and sensitive inference. *Big-list cost blow-up* → estimate credits **before** the run, hard per-run + per-account caps, provider rate-limiting + backoff, cache so we never re-pay.
- **Benchmark (beat this):** Clay — 11 AI prompts to automate prospect research with Claygent [how it works: the actual research prompts] — https://university.clay.com/lessons/11-ai-prompts-to-automate-prospect-research-with-claygent-automated-outbound ; Clay — Claygent Builder — https://university.clay.com/docs/claygent-builder ; UserGems — signals — https://www.usergems.com . **Build docs:** the deep-research skill + signal schema on the durable runner (H5).

## Journey 7d.20 — Deep research to sell over MANY records (how it relates to AI columns)

*As a rep, I want to run that deep research across a whole list with one click and a review step, so I prep an entire territory at once.*

**Your question, answered — yes, this is the AI-column pattern, so it merges here.** "Deep research to sell over a selection" is not a separate engine: it is the **per-record skill (7d.19) run over many rows**, exactly like an **AI column** ([4g](4g-crm-ai-columns.md)) with a **▶ play one** and a **Run on selection / Run whole column**. So:

1. **Entry.** People/Companies view → select rows (or the whole list) → **Actions → Deep research**; or add a **"Research to sell" AI column** (4g) and hit **Run column**.
2. **Steps.** Each row runs the 7d.19 skill on the durable runner (**job H5**), streaming results into the cell/timeline with provenance; a review step gates any writes. Shows an **estimated credit cost before the bulk run** (7d.21).
- **Build docs:** reuses 4g (per-row AI + run-many) + the 7d.19 skill; job H5.

---

# Monitoring journeys

## Journey 7d.21 — Cost monitoring (rep + admin objectives)

*As an admin, I want to see and cap what enrichment costs, so it never surprises me on the bill.*

1. **Entry.** Settings → Enrichment → **Monitoring → Cost.**
2. **Read.** A dashboard by **object / provider / field / time**: spend, successful-enrichment count, **cost per successful enrichment**, and top spenders. Filters by date range and object.
3. **The rep-facing objective (before a spend).** Any bulk action (7d.12, 7d.18, 7d.20) shows an **estimated credit cost before running**, with a confirm above a threshold — so the person spending sees the cost at the moment of choice.
4. **Guardrails the admin sets:** **mandatory run conditions** ("only if empty / stale / low confidence" — never re-pay for data we have), **per-field budget caps** (stop a field's waterfall after $X/day), and a **dry-run on a sample** (7d.4) before enabling a costly waterfall.
- **Benchmark (beat this):** Clay — credit usage (Settings → Usage, sorted by workbook/table) [how it works] — https://university.clay.com/docs/credit-usage ; Clay — Actions vs Data Credits (the two-meter model) — https://university.clay.com/docs/actions-data-credits . **Build docs:** roll up `EnrichmentRun.cost`; caps on `EnrichmentSource`.

## Journey 7d.22 — Cost anomaly alert (background job + admin journey)

*As an admin, I want to be told if enrichment spend spikes, so a runaway waterfall doesn't burn the budget overnight.*

1. **Trigger.** A daily pg-boss cron (`0 5 * * *`) compares yesterday's enrichment spend to the trailing 7-day average.
2. **If spend > 2× the average (then):** raise an alert in the [super-admin cost console](13a-superadmin-cost-monitoring.md) and notify the workspace admin, naming the object/provider/field driving it.
- **Build docs:** reuses the cost-monitoring job family (doc 13a).

## Journey 7d.23 — Accuracy monitoring: is a source still good?

*As an admin, I want to know which providers are actually returning correct data, so I can re-rank or retire them.*

1. **What we store.** Per value: the **answering provider + confidence + fetch date** (provenance, 7.9). Plus built-in validators run at write time: **email verification** (deliverable?) and **phone E.164 validation**.
2. **Read.** Settings → Enrichment → **Monitoring → Accuracy**: a rolling **per-provider match-rate** report (how often a provider's value survived validation / wasn't later rejected by a human), per field.
3. **Admin objective + action.** **If a provider's match-rate drops below a threshold (then):** the report flags it and offers to **re-order the waterfall** (demote it) or **disable** it. A human **reject** of an AI/enriched value (7.9) is the strongest negative signal and feeds this rate.
- **Benchmark (beat this):** internal — provenance-driven match-rate. **Build docs:** roll up `Provenance.status` + validators by `source`.

## Journey 7d.24 — Super-admin: waterfall & provider health (monitoring)

*As a super-admin at our company, I want fleet-wide provider health so I can drop a provider that gets enjoined or degrades.*

1. **Entry.** The [super-admin console](13-superadmin-console.md) → Enrichment health.
2. **Read.** Across all workspaces: per-provider uptime, error rate, average latency, cost, and match-rate; which fields depend on each provider.
3. **Action — the kill-switch.** A **disable-provider** control drops a provider everywhere at once (e.g. a source that gets legally enjoined, 7d.25); waterfalls fall through to the next step automatically. **If a disabled provider was the only step for a field (then):** that field stops enriching and the console flags the affected workspaces.
- **Build docs:** ties to [13b kill-switches](13b-superadmin-model-and-killswitches.md).

---

## Journey 7d.25 — LinkedIn sourcing and the legal stance (reference)

*As an admin, I want to know how LinkedIn-derived data reaches the app and why, so I understand the coverage and the risk.*

LinkedIn is the richest source for title, seniority, job history, location, and posts — but **we do not run our own LinkedIn scrapers, and we never automate a customer's logged-in LinkedIn session inside the product.** LinkedIn-derived fields come through the waterfall via **licensed data aggregators** (People Data Labs, Coresignal) and **public-data APIs** (Bright Data). Why this line: after *hiQ v. LinkedIn*, scraping *public* pages isn't a federal (CFAA) crime, **but it breaches LinkedIn's User Agreement**, and LinkedIn litigates hard — it forced **Proxycurl** to shut down in July 2025 over logged-in/fake-account scraping. So we **never promise** an "official LinkedIn integration," guaranteed coverage/freshness, or real-time post feeds; we promise "aggregated public + licensed third-party data; coverage varies; you control retention," keep provenance, honor deletion, and keep a **kill-switch** (7d.24) to drop any provider that gets enjoined.
- **Benchmark (beat this):** People Data Labs — person enrichment — https://docs.peopledatalabs.com/docs/person-enrichment-api ; Bright Data — public-data LinkedIn APIs — https://brightdata.com/products/web-scraper/linkedin .

## What we won't support (reference)

Scraped personal face photos; unbounded untargeted scraping; sensitive/biometric or health-inference enrichment; providers that can't attribute source + confidence; "enrich everything every run" with no run condition; healthcare data silently falling through to third parties (the 7d.26 hard-block prevents it).

## Journey 7d.26 — The three scenarios, as step-by-step journeys

*As an admin, I want to see exactly how the tricky enrichment cases play out step by step, so I can set them up correctly.*

*You asked for these spelled out as journeys (who clicks what, what happens next).*

**Scenario 1 — Healthcare: only the customer's own source is valid.**
*As a compliance-bound admin, I want third-party fallthrough hard-blocked, so PHI never leaks to public providers.*
1. Admin goes to Settings → Enrichment → Waterfalls → picks the field.
2. Adds a **single step** pointing only at their **custom HTTP source** (7d.5).
3. Ticks **"Hard-block fallthrough"** (the checkbox in the 7d.4 editor).
4. **Result:** if that source misses, the waterfall **stops** — it never falls through to a third party. Nothing leaks. (`hardBlockFallthrough = true` on the source.)

**Scenario 2 — Doesn't know the website but knows other attributes.**
*As a rep with only a person's email, I want the company resolved and enriched.*
1. Rep clicks **Enrich** on a Person record that has an email but no company domain.
2. The reverse-enrichment path (7d.13) resolves the **canonical domain** from the email domain first.
3. It then runs the normal Company waterfall against that domain and fans out contacts if configured (7d.14).
4. **If ambiguous:** it asks "we think this is X — confirm?" rather than guessing.

**Scenario 3 — Wants to exclude known-bad sources.**
*As an admin, I want to ban a provider from a field.*
1. Admin opens the field's waterfall (7d.4).
2. Adds the provider to the **Deny** list.
3. **Result:** that provider is never tried for that field, even if listed as a step elsewhere.

---

## Background jobs (what runs on its own, and when)

- **H2 — Enrich.** Trigger: `Record.created`, `Record.addedToList`, or a manual/bulk request. pg-boss queue `enrich`, `singletonKey = recordId:reason`, `retryLimit: 3`, exponential backoff (rate-limited providers). Steps: per-field waterfall → run-condition check → first confident hit → cast+validate → fan-out arrays → write + Provenance row. Seconds per record; batched for selections.
- **H4 — Signal research.** Trigger: cron (default `0 6 * * *`, workspace tz) + on-click. Runs web-research for watched accounts; writes dated, cited signals; feeds the [7c](7c-ai-decision-engine.md) digest. `claude-haiku-4-5` scan / `claude-sonnet-5` summary.
- **H5 — Skill / deep-research runs.** Trigger: a skill or "Deep research" over a selection. Durable runner, retries, minutes for big batches. `claude-sonnet-5` for judgment-heavy research.
- **Cost-anomaly cron** (7d.22): `0 5 * * *`, compares to trailing average.

---

## Data model (Prisma) — enrichment

Extends the cumulative schema (models defined in [7](7-ai-copilot.md): `EnrichmentSource`, `EnrichmentRun`, `Provenance`). No new models here; this doc is the journeys over them. Key fields used above: `EnrichmentSource.kind` (provider | http | agent | formula), `.fieldChains` (per-field ordered steps + allow/deny), `.byok`, `.authRef`, `.runCondition`, `.hardBlockFallthrough`; `EnrichmentRun.kind/trigger/provider/resultJson/status/cost`; `Provenance.source/confidence/status`.

---

## Cross-doc references preserved
Replaces and expands the old **Journey 7.7 / 7.7a–7.7f** (now this doc). Related: AI columns [4g](4g-crm-ai-columns.md) (bulk per-row runs), composite cells [4f](4f-crm-composite-cells.md) (array display), provenance [7k](7k-provenance.md), the decision engine [7c](7c-ai-decision-engine.md) (consumes signals), skills [7f](7f-skills.md) (research skills), super-admin cost [13a](13a-superadmin-cost-monitoring.md) / kill-switches [13b](13b-superadmin-model-and-killswitches.md).
