# Doc 9 — Deal Board & Forecasting

The **deal-centric operating surface**: a board of open opportunities, warning flags, AI-surfaced risks with evidence, a multi-threading view, a per-deal timeline, one recommended next action, and a stage-weighted forecast. This is where a rep (and later a manager) *works the pipeline*, distinct from doc 5b's reporting page (which *measures* it).

**Benchmarks (chosen per feature, not one blanket pick):**
- **Gong — Deal Board + AI Deal Monitor** (warnings + how each is detected). *Note: deal warnings are a Gong **Deals/Forecast** feature, not Gong Engage — Engage is the outbound/next-action product. We cite each where it actually applies.* — https://help.gong.io/docs/understanding-deal-boards
- **Decagon (Watchtower) + Intercom (Fin)** — surfacing risky issues from conversations via **customer-defined, natural-language signals** (the model for our customizable risk skills).
- **HubSpot / Pipedrive** — kanban deal board + stage-weighted pipeline value.
- **Clari** — deal inspection + pipeline waterfall (waterfall overlaps doc 5b.8b; this doc is the operational entry point, cross-referenced, not rebuilt).

**Phase note:** the board, warnings, AI risks, multi-threading, timeline, next-action, and the **personal** stage-weighted forecast are single-user and build now. Anything that rolls up **across people** — team/manager ownership filters, [LATER] team forecast — is tagged **[LATER]**; the data model is built now so teams (doc 11) become a rollup, not a rewrite.

**Journey numbering:** doc 9, so journeys are `Journey 9.1`, `9.2`, … (Numbering changed this round: the old 0–100 risk *score* journey was removed, the two [LATER] forecast-rollup journeys were removed, next-action and scorecards were split into sub-journeys. Cross-doc references were updated to match.)

**Covers:** deal board with key fields + ownership filter + closed-won/lost handling; deal warnings (deterministic) and AI-surfaced deal risks (inference, evidence-grounded, customizable); multi-threading view; deal timeline; recommended next action (produce / method / accept-reject UI); stage-weighted pipeline forecast with period comparisons; the pipeline-change waterfall entry point; rep scorecards (schema CRUD + usage).

---

## Journey 9.1 — The deal board (viewing)

*As a rep (AE), I want to see my open deals as cards in stage columns with their value and warnings, so that I can work my pipeline and not let a deal slip unnoticed.*

**Why this surface matters (moved here from the old doc intro).** The board serves two audiences with one artifact:
- **AEs managing their pipeline** — a deal goes quiet, stalls in a stage, or is single-threaded on one contact who leaves, and nobody notices until the number slips. The board makes at-risk deals **surface themselves** and tells the rep the single highest-leverage next step (Journey 9.5).
- **Managers / CROs forecasting and troubleshooting** — the board is where they **forecast** the period (stage-weighted value, Journey 9.6) and **diagnose the root cause** of a bottleneck or a wave of stalled deals (which stage clogs, which warnings dominate, what changed since last period). This is the operational counterpart to doc 5b's reporting.

1. The rep opens **Deals → Board**. Open opportunities are **cards in stage columns** (the pipeline stages from doc 4.9). Drag-and-drop a card between columns sets its stage (job E1 logs the stage change).
2. **Each card shows key fields:** deal name, company (with logo), **amount**, **close date**, primary contact, **warning-flag chips** (Journey 9.2, e.g. `Stalled 21d`, `Ghosted`), and a compact **AI-risk badge** (`⚠ 2`) when the deal has open AI-surfaced risks (Journey 9.2). Card fields are configurable like a kanban card (doc 4.9). *There is no 0–100 health score or green/amber/red chip — see the decision below.*
3. **Column headers show `count · Σ amount · Σ weighted`** (the weighted figure is Journey 9.6). Two quick-filters sit on top: **"Closing this period"** and **"Needs attention"** (any deal with an open warning or AI risk).
4. **Ownership filter** (top-left of the board) — see Journey 9.1a.
5. **Closed Won / Closed Lost columns** — see Journey 9.1b.
6. Clicking a card opens the **deal detail** — the record page (doc 4.11) with the timeline (9.4), multi-threading (9.3), warnings/risks (9.2), and next action (9.5) surfaced.
7. This is the same board engine as doc 4.9 kanban, specialized for Deals.

- **Benchmark (beat this):** HubSpot — deals board in the sales workspace (see the kanban, card fields, column totals) — https://knowledge.hubspot.com/prospecting/create-and-manage-deals-in-the-sales-workspace ; Gong — understanding deal boards (card-level warnings baked in) — https://help.gong.io/docs/understanding-deal-boards . *What we like:* HubSpot's card + column-total layout; Gong's per-card risk surfacing.
- **Build docs:** dnd-kit — sortable — https://dndkit.com/presets/sortable ; internal — reuses doc 4.9 kanban.

## Journey 9.1a — Filter the board by ownership

*As a rep or manager, I want to switch whose deals the board shows, so that I can look at just my pipeline, a teammate's, a team's, or everyone who reports to a manager.*

1. A **"Owner" control** sits top-left of the board. Its options:
   - **Me** (default, one click) — the signed-in user's deals.
   - **A person** — pick any single owner *(needs teams; [LATER])*.
   - **A collection of people** — multi-select several owners *(needs teams; [LATER])*.
   - **A team** — all members of a team (doc 11) *([LATER])*.
   - **Reports to a manager** — everyone in a manager's org, rolled up (doc 11 hierarchy) *([LATER])*.
2. The chosen owner scope is **combined with any other board filters** (Journey 9.1c) — e.g. `Owner = my team` **and** `Account type = Enterprise`.
3. **Now vs. [LATER]:** solo users get **Me** only (the only owner that exists). The control renders now; the multi-owner options are gated until teams (doc 11) land — the same "spec the model, gate the UI" pattern the repo uses. The visibility resolver (doc 11) decides which owners a user is *allowed* to select.

- **Benchmark (beat this):** HubSpot / Salesforce — "My deals / My team's deals" owner filters + role-hierarchy rollup — https://knowledge.hubspot.com/records/filter-records . *What we like:* the one-click "mine" default plus a team rollup that respects the role hierarchy.
- **Build docs:** internal — the owner/team visibility resolver (doc 11); board query filters on `ownerId ∈ resolvedSet`.

## Journey 9.1b — Closed Won and Closed Lost on the board

*As a rep or manager, I want closed deals handled sensibly on the board, so that the board stays about live work but I can still see and total what was won.*

**The problem:** if every closed deal stayed on the board forever, the terminal columns would grow without bound and the value totals would be meaningless. So:

1. **Two terminal columns** — **Closed Won** and **Closed Lost** — sit at the right of the board, each **collapsed by default** (a thin column showing just `count · Σ amount`); click to expand.
2. **A date bound applies to closed columns only:** they show deals **closed within the board's active period** (default "this period"; follows the period selector used by Journey 9.6). Older closed deals drop off the board (still in the Deals table/reports). Open columns are never date-bounded this way.
3. **Effect on calculations (stated so it's unambiguous):**
   - **Open pipeline totals** (raw `Σ amount` and `Σ weighted`, Journey 9.6) = **open columns only**. Closed Won and Closed Lost are **excluded** from pipeline totals.
   - **Closed Won** carries a **100% weight** and is summed into a separate **"Won this period"** figure in the board summary — not into open pipeline.
   - **Closed Lost** carries **0% weight**, contributes to **no value total**, and is kept only for **count / win-rate** (Won count ÷ (Won + Lost count)).
   - The board summary therefore shows three distinct numbers: **Open pipeline (raw)**, **Open pipeline (weighted)**, and **Won this period**.

- **Benchmark (beat this):** Pipedrive — won/lost handling on the pipeline view (closed deals leave the active pipeline; won value totals separately) — https://www.pipedrive.com/en/features/pipeline-management . *What we like:* the clean separation of open pipeline from booked/won value.
- **Build docs:** internal — board query splits open vs. terminal stages; terminal stages date-bounded to the active period.

## Journey 9.1c — Other board filters

*As a rep or manager, I want to filter the board by deal attributes, so that I can focus (e.g. only Enterprise deals closing this quarter).*

1. A **filter bar** (same control as the CRM view filters, doc 4c) lets the user filter cards by any Deal attribute — **account type**, close-date range, amount range, warning present, AI risk present, tag, etc.
2. Filters **stack with the ownership scope** (9.1a) and the period selector (9.6), and are saved with the board view (doc 4c `SavedView`).

- **Benchmark (beat this):** Attio — record view filters — https://attio.com/help/reference/views . *What we like:* composable attribute filters reused across every view.
- **Build docs:** internal — reuses doc 4c view-filter engine on the board query.

## Journey 9.2 — Deal warnings and AI-surfaced risks

*As a rep, I want the board to flag deals that need attention — both the factual "no meeting booked" kind and the judgment "the prospect said something that doesn't match our CRM" kind — so that I act on real risk without drowning in false alarms.*

**The design decision (changed this round): no single risk *score*.** We deleted the old 0–100 health score. A single number **asserts false confidence** — it hides *why*, it's gameable, and at launch we have no win/loss corpus to justify any weighting. Instead we surface **discrete, explainable, evidence-grounded risks**, split into two tiers by how reliably we can detect them.

**Benchmark laid out first — Gong's deal warnings and how it detects each** (from Gong's deal-warning docs; you asked me to start here). *One correction from the research: these live in Gong's **Deal Board / "AI Deal Monitor,"** not Gong **Engage** — Engage is the outbound/next-action product. So for deal risks the right benchmark is the Deal Board, and Gong's own rule-vs-AI split is exactly the Tier A / Tier B line we adopt:*

| Gong warning | How Gong detects it | Our tier |
|---|---|---|
| No Activity | rule: no call/email either side in N days | A |
| Ghosted | rule: no *prospect-side* activity in N days (excludes auto-replies/OOO) | A |
| Overdue | rule: CRM close date is in the past | A |
| Not Enough Contacts | rule: fewer than N active prospect contacts over X days | A |
| Stalled in Stage | rule: CRM stage unchanged for N+ days | A |
| No Power | hybrid: infers seniority from CRM titles + **email-signature parsing**; fires if none senior while closing soon | A (light hybrid) |
| Pricing Not Mentioned | **AI/NLP** over call/email content: pricing not discussed while closing soon | B |
| Red Flag | **AI/ML classifier** over email content flags risk language | B |
| Forecast red flags (legal not engaged late · too many logistics emails · no next steps set on call · late competitor mention) | **AI** over call/email content | B |

The two tiers below map onto this: everything Gong does with a **rule over structured/activity data** is our Tier A; everything it does with **AI over conversation content** is our Tier B (plus the "said-vs-CRM" class Gong doesn't do, which we add).

### Tier A — Deterministic warnings (factual, low false-positive, no content-reading)

These count or compare structured CRM + activity data. They are **reliable**, so they render as **flag chips** on the card with a configurable threshold, each toggleable in **Settings → Deal warnings**:

1. **No activity** — no calls/emails either side for X days.
2. **Ghosted / gone quiet** — no *prospect-side* activity for X days (excludes auto-replies / out-of-office).
3. **Stalled in stage** — no stage change for ≥X days (per-stage threshold).
4. **Overdue** — close date is in the past.
5. **No next meeting** — nothing scheduled ahead.
6. **Single-threaded** — ≤N contacts engaged (multi-threading proxy, Journey 9.3).
7. **No power** — no Director/VP/C-level engaged while closing within X days (uses the `persona` field, doc 4; a light hybrid — persona is structured, but persona itself may be inferred).

*These are the rule-detected warnings from the table above — the risks we can compute without asserting false confidence.*

### Tier B — AI-surfaced risks (judgment, require inference over conversation content + full account context)

**You're right that these can't be computed from deterministic signals.** They require **reading the full context of the account** (the deal timeline — calls, emails, notes, doc 9.4), **running inference**, and **applying judgment embedded in a system prompt / skill**. Each is surfaced only with **cited evidence** and above a **confidence threshold**, so the rep can verify rather than trust a black box. The default catalog (each a customizable skill, below):

- **Missed a committed deadline** — the prospect (or we) committed to a date/action on a call/email and it passed without the follow-through. *Evidence: the quote + the elapsed date.*
- **Promised-but-didn't-send** — the prospect said they'd send something (security questionnaire, intro, signed doc) and it hasn't arrived within X hours/days.
- **Said-vs-CRM mismatch** — the prospect **said** something in a conversation that **isn't reflected in the structured CRM fields**, e.g.:
  - stated a **timeline** ("we need this live by Q1") that doesn't match the deal's Close Date;
  - named a **decision-maker / another stakeholder** we don't have listed as a contact with the right `persona`;
  - named an **incumbent / competitor** not recorded;
  - stated a **budget / metric** not captured.
  *This mapping ("what the prospect says" → "which structured field") **differs per company / object type**, so the default skill is **per deal-object variant** and workspace-editable (below). Evidence: the quote + the field it contradicts.*
- **Conversation red flags** (from call/email intelligence, doc 6): negative sentiment trend, a **competitor mentioned late-stage**, **pricing never discussed** while closing soon, **no concrete next step set on the last call**. *These mirror Gong's AI-detected warnings (Red Flag, Pricing Not Mentioned) and its "four forecast red flags," all of which Gong detects with NLP over conversation content — not CRM fields.*

**Customizable, natural-language risk skills (the Decagon/Fin model).** Each Tier-B risk is a **skill** (doc 7.8) defined in **plain language**, not a rigid keyword rule — the same approach Decagon's Watchtower ("natural-language flags") and Intercom Fin (natural-language category/attribute definitions) use for surfacing issues from support chats. We ship a **default set per deal-object type**; a workspace **edits the prompt, tunes the confidence threshold, or turns a risk off**. Example default skill body: *"Read this deal's timeline. If the prospect stated a go-live or purchase timeline that is earlier or later than the deal's Close Date by more than 2 weeks, surface a `timeline_mismatch` risk, quoting the exact line and naming the Close Date. Only fire if you can cite a specific statement; if unsure, do not fire."*

**Honesty about what we *can't* do reliably (so we don't reintroduce false confidence):**
- We **do not** emit a win-probability number or a composite score.
- We **do not** infer risk from tone alone without a corroborating signal.
- We **defer** most "bad CRM update" field-by-field mismatches beyond the high-value ones above — they're low-value and error-prone at scale (Gong's own low-value defers).
- We surface a Tier-B risk **only with evidence and above the confidence threshold**; a risk we can't ground in a quote is not shown. False negatives (a missed risk) are preferred to false positives (crying wolf), because a noisy risk feed gets ignored.

**Model & why (guidance #17).** Tier-B inference reads long context and applies judgment, so the default is a **reasoning model — `claude-sonnet-5`** (long-context synthesis, quality over latency, runs on a cadence not per-keystroke — same rationale as the doc 6 call brief). A cheap **`claude-haiku-4-5`** pre-pass triages *which* deals changed enough to be worth a Sonnet pass, controlling cost. Both are backend-selectable (super-admin), consistent with docs 4g/6/7.

**How risks render & are actioned:**
1. On the **card**: Tier-A warnings as chips; Tier-B as a compact `⚠ N` badge.
2. On the **deal detail**: a **Risks panel** lists each open risk as a sentence + its **evidence link** (the call/email it's grounded in) + **Dismiss** / **Mark resolved**. Dismiss records a reason and suppresses that risk until new signal appears.
3. Resolving a risk often **is** the next action (Journey 9.5) — e.g. a `timeline_mismatch` risk's action is "update Close Date or confirm the timeline with the prospect."

- **Benchmark (beat this):**
  - Gong — deal warnings + how each is detected (rules vs. AI) — https://help.gong.io/docs/using-deal-warnings ; the AI-detected forecast red flags — https://www.gong.io/blog/spot-these-four-red-flags-to-boost-forecast-accuracy-and-revenue-predictability . *What we like:* the explicit split between rule-based and conversation-AI warnings; we adopt it as our Tier A / Tier B line.
  - Decagon — Watchtower natural-language flags over conversations — https://decagon.ai/blog/decagon-watchtower ; Intercom — Fin AI category detection (natural-language signal definitions) — https://fin.ai/help/en/articles/10624992-use-ai-category-detection-in-fin-workflows . *What we like:* customer-defined, plain-language signals — the model for our editable risk skills.
- **Build docs:** internal — Tier A = rules over activity/relations (job F-DEAL1, deterministic path); Tier B = risk skills (doc 7.8) run by job F-DEAL2 with evidence + confidence; thresholds/skills in settings.

## Journey 9.2a — Configure warnings and risk skills (config, distinct from the usage above)

*As an admin, I want to tune which warnings fire, at what thresholds, and edit the plain-language risk skills, so that the board matches our sales motion instead of crying wolf.*

Journey 9.2 is **usage** (seeing/actioning warnings); this is the **config**.

1. The admin opens **Settings → Deal warnings & risks**.
2. **Tier-A warnings** — a list of the 7 warnings, each a row with a **toggle** (on/off, writes `DealWarningConfig.enabled`) and its **threshold input** (`{days}` or `{minContacts}`, writes `thresholdJson`). Changes take effect on the next F-DEAL1 run.
3. **Tier-B risk skills** — a list of the shipped default skills, grouped by the deal-object type they apply to. Each row shows the skill **name**, an **enabled toggle**, and a **confidence slider** (`minConfidence`, default 0.7). **Edit** opens the **plain-language prompt** (`promptMd`) in a text editor with the example body pre-filled; the admin rewrites it in English (the Decagon/Fin model), Saves, and the next F-DEAL2 run uses it. **New** creates a workspace-specific skill; a shipped default can be reset (`isDefault` restores the seeded prompt).
4. Editing a skill's prompt **does not** rewrite past `DealRisk` rows — it applies going forward (past risks keep their evidence).

- **Benchmark (beat this):** Gong — customize deal-warning settings (per-warning toggle + threshold) — https://help.gong.io/docs/customize-your-deal-warning-settings ; Decagon — Watchtower natural-language flag setup — https://decagon.ai/blog/decagon-watchtower . *What we like:* Gong's per-warning threshold UI for Tier A; Decagon's "describe the signal in English" editor for Tier B.
- **Build docs:** internal — CRUD on `DealWarningConfig` + `DealRiskSkill` (below); a settings form.

## Journey 9.3 — Multi-threading view (who's engaged, who's missing)

*As a rep, I want to see every person engaged on a deal and who's missing, so that I widen the relationship before a single contact can sink it.*

1. On a deal, a **contacts-engaged panel** lists every person touched (from calls, emails, meetings — doc 4a related activity), each with **persona** (decision_maker / champion / gatekeeper…), last-touch date, and engagement level.
2. It **flags single-threaded** ("only 1 contact engaged on a $X deal") and **no-power** ("no decision-maker engaged") — the same signals feeding Tier-A warnings 6 & 7.
3. **Design rule from the data:** the *account* should be multi-threaded, but each *message* stays 1:1 — the view encourages adding contacts, never mass-emailing them.
4. A one-click **"find the decision-maker"** hands off to the enrichment skill (doc 7.8) to source the missing senior contact.

- **Benchmark (beat this):** Gong — multi-threading / engagement map — https://www.gong.io/resources/guides/the-data-backed-guide-to-multi-threading-and-team-selling . *What we like:* the engagement-map view and the closed-won-vs-lost contact-count data behind it.
- **Build docs:** internal — reuses doc 4a's related-activity feed + the persona field.

## Journey 9.4 — Deal timeline (every touch in one place)

*As a rep, I want one chronological view of every touch on a deal, so that I can get current in seconds and so the AI has the context it needs.*

1. The deal detail shows a **unified chronological timeline** of every touch — calls, emails, meetings, notes, files, stage changes, field changes, and AI signals (doc 7.7c) — newest first.
2. Each entry links to its source (the call record, the email thread, the meeting recording).
3. This is doc 4a's related-activity feed scoped to one deal (its people + company), so it opens fast (job E5's denormalized feed). **It is also the context window the Tier-B risk skills (9.2) and the next-action drafter (9.5) read.**

- **Benchmark (beat this):** Clari — deal inspection details — https://www.clari.com/products/inspect/ ; Attio — record activity — https://attio.com/help/reference/managing-your-data/records/add-record-activities . *What we like:* Clari's single-deal inspection surface; Attio's fast, linkable activity feed.
- **Build docs:** internal — doc 4a activity feed, deal-scoped.

## Journey 9.5 — Recommended next action per deal

Split into three sub-journeys: **9.5.1** what the rep sees, **9.5.2** how it's produced (with the options weighed), **9.5.3** the accept/reject UI across screens.

### Journey 9.5.1 — Seeing the recommended action

*As a rep, I want one clear recommended next step per deal, so that I never stare at a deal wondering what to do.*

1. Each deal shows **exactly one recommended next action** — the single highest-leverage step (e.g. "Single-threaded on a $40k deal closing in 12 days → intro-email the economic buyer").
2. If several warnings/risks fire, **one action wins** — chosen by the highest-priority open risk. **Priority = the importance ranking (Imp 1–10) in the [AI Next-Action Playbook](../other/ai-next-action-playbook.md)'s deal-risk catalog** (e.g. no-power/overdue outrank no-activity); ties break by most-recent evidence. So the rep sees one action, not a pile.
3. The action states **why** (the risk it resolves) and the **execution** it will perform (draft this email / create this task / book this meeting).

- **Benchmark (beat this):** Clari — recommended actions on the deal-inspection surface — https://www.clari.com/products/inspect/ . *What we like:* the risk → recommended-action linkage sitting on the same deal-inspection view.

### Journey 9.5.2 — How the action is produced (and the options we weighed)

*As the system, I want to pick the right play deterministically and draft the execution with AI, so the recommendation is both reliable and specific.*

**Options considered:**
- **(a) Pure deterministic template** — each warning maps to a fixed action + a canned email template. *Reliable and cheap, but generic — a canned email ignores the deal's actual context, so reps rewrite it every time and stop trusting it.*
- **(b) Pure AI free-form** — hand the timeline to an LLM and ask "what should I do next?" *Specific, but unreliable about **which** problem matters most; it wanders, and can miss the obvious structural risk (single-threaded, overdue) a rule would always catch.*
- **(c) Hybrid — deterministic play selection + AI-drafted execution (chosen).** The warning/risk layer **deterministically picks the play** from the winning risk (single-threaded → "multi-thread"; gone quiet → "re-engage"; timeline mismatch → "confirm timeline / fix close date"); the copilot (doc 7) **drafts the execution grounded in the deal timeline** (9.4).

**Why (c):** neither (a) nor (b) alone is enough — pure rules can't write the specific email, pure AI isn't reliable about *which* play. The hybrid gets reliability from the rule and specificity from the draft. This is the same split the AI Next-Action Playbook uses ([W] deterministic + [S] skill).

- **Build docs:** internal — warning→play map + copilot draft (doc 7); job F-DEAL3 pre-drafts the execution.

### Journey 9.5.3 — Viewing and accepting / rejecting the action

*As a rep, I want to accept or reject the recommendation wherever I encounter it, so that acting on it is one click from any screen.*

The recommended action is the **same object** surfaced at several points in time / screens; accept/reject runs the copilot's accept-reject flow (doc 7.1) everywhere:

1. **On the board card (glance):** a small next-action affordance on hover/focus — a one-line label + an **Accept** button and a **⋯ (dismiss)**. Accept opens the drafted execution in a lightweight popover (edit → send/create); dismiss asks an optional reason.
2. **On the deal detail (deep work):** a **Next action card** at the top of the deal — the full drafted email/task/meeting inline, with **Accept** (executes: sends the email / creates the task / books the meeting, via accept/reject + provenance, doc 7.1), **Edit**, and **Reject** (with reason; logs feedback for the skill).
3. **In a "Deals needing action" queue (batch, morning triage):** a list across the pipeline of every deal with an open recommended action, each row Accept/Reject inline — so the rep clears the queue like an inbox. *(The queue is the daily entry point; [LATER] a digest notification links to it.)*
4. **From the copilot (conversational):** asking the copilot about a deal surfaces the same recommended action with the same accept/reject controls (doc 7.1).

**State across screens:** accepting or dismissing in one place updates the action everywhere (it's one record). A dismissed action is suppressed until new signal changes the underlying risk, at which point job F-DEAL3 produces a fresh one.

- **Benchmark (beat this):** Gong **Engage** — next-best-action + execution (this **is** an Engage feature, unlike deal warnings, so we cite Engage here specifically) — https://www.gong.io/platform/sales-engagement-software . *What we like:* the accept-and-execute flow surfaced inline where the rep already works.
- **Build docs:** internal — copilot accept/reject + provenance (doc 7.1); the queue reuses the CRM task/attention list (doc 4e).

## Journey 9.6 — Stage-weighted pipeline forecast (simplified)

*As a rep or manager, I want one honest "what will I likely close" number derived from deal amounts and stage probabilities, so that forecasting is a transparent setting I control, not a black box.*

**This replaces the old forecast-category machinery.** No `forecastCategory` field, no submission workflow — just amount × a per-stage probability that anyone can see and change. A **period selector** in the board summary — **This month / This quarter / This year / Custom** (default: this quarter) — scopes the "Closing this period" filter (9.1), the closed-column date bound (9.1b), and the comparison baselines in step 4; it is saved with the board view (doc 4c).

1. **Amount is a default field on every deal** (already seeded on the Deal object, doc 4).
2. **Each pipeline stage has a probability weight** — a first-class, **clickable setting** (the config for this journey). In **Settings → Pipeline → Stage weights**, an admin sets each stage's win probability (e.g. **Stage 1: 10% · Stage 2: 30% · Stage 3: 50% · … · Closed Won: 100% · Closed Lost: 0%**). Editable any time; seeded with sensible defaults.
3. **The board shows the weighted (forecasted) value everywhere:**
   - **Per deal** — `amount × stage probability`, shown on the card (e.g. `$40k → $12k @30%`).
   - **Per column** — the header shows `count · Σ amount · Σ weighted`.
   - **Overall** — the board summary shows **Σ amount** and **Σ weighted** across all open columns (plus **Won this period** at 100%, Journey 9.1b).
4. **Optional period-comparison toggles** — two buttons in the board summary, off by default, that add a delta **in every place a value is shown** (per deal, per column, overall):
   - **% change since last period** — vs. the same value at the start of the current period.
   - **% change since last year's period** — vs. the same value one year prior.
   These read **point-in-time snapshots** (`PipelineSnapshot`, doc 5b — the same nightly snapshot; no new job), diffing the value now against the value at the comparison date.

**Closed-deal handling in the math** is defined in Journey 9.1b (open columns feed pipeline totals; Won at 100% is a separate figure; Lost at 0% is excluded from value).

- **Benchmark (beat this):** HubSpot — deal-stage probability & weighted pipeline — https://knowledge.hubspot.com/deals/use-deal-stage-probability ; Pipedrive — weighted pipeline value — https://www.pipedrive.com/en/features/pipeline-management . *What we like:* a transparent per-stage probability the user edits, with a weighted total that updates live.
- **Build docs:** internal — `winProbability` on the `PipelineStage` model (doc 4) + weighted sums on the board query; period deltas from `PipelineSnapshot` (doc 5b).

## Journey 9.7 — Pipeline-change waterfall (entry point)

*As a manager or rep, I want to see how the pipeline changed between two dates and why, so that I can diagnose what moved the number.*

1. **Entry point:** a **"Pipeline changes"** button in the board summary (next to the period selector) opens the waterfall in a panel, pre-filled with the current period's two dates (start → today); the user can change either date.
2. A **waterfall** shows how the pipeline changed between any two dates and *why*: **New (created), Moved In / Out, Moved Up / Down, Filtered Out, close-date pushes, amount** pull-ins/increases/decreases (the Clari model).
3. It runs off **point-in-time snapshots** (`PipelineSnapshot`, doc 5b) — the same snapshots that power the % change toggles (9.6).
4. **This is the deal-board entry point to the waterfall already specced on the reporting page (doc 5b.8b) — same engine, surfaced here for the operational view. We don't build it twice.**

- **Benchmark (beat this):** Clari — Flow Analytics (pipeline waterfall) — https://www.clari.com/blog/new-from-clari-next-level-analytics-for-revenue-leaders/ . *What we like:* the bridge from starting to ending pipeline with a labeled bar per reason.
- **Build docs:** internal — see doc 5b.8b's waterfall + the `PipelineSnapshot` table.

## Journey 9.8 — Scorecard schema: create, edit, version, archive (CRUD) [LATER, needs multi-user]

*As a manager, I want to create and maintain scorecard schemas, so that calls are graded consistently and old scores stay interpretable when I change the questions.*

A **scorecard** is an ordered set of typed criteria (numeric 1–3 scale / boolean / **AI-evaluated**) used to grade a call — e.g. problem identified, stakeholder mapped, next step committed, qualification depth, talk-ratio.

1. **Create** — the manager opens **Settings → Scorecards → New**, names it, picks a **call type** it applies to, and adds ~5–8 criteria, each with a **label** and a **kind** (`scale_1_3` / `boolean` / `ai_evaluated`) and a sort order. Save creates a `Scorecard` at `version 1`.
2. **Read (list + preview)** — the Scorecards list shows each schema (name, call type, version, #criteria, archived state); clicking previews the criteria as they'll appear on a call.
3. **Edit → version bump** — editing criteria on an in-use scorecard **creates a new version** rather than mutating in place, so historical `ScorecardResult`s (which pin `scorecardVersion`) stay interpretable. The editor warns "editing will create v N+1; past scores keep v N."
4. **Archive** — a schema no longer used is archived (`isArchived`), hidden from new scoring but kept for old results. (Hard delete is blocked once results reference it — reuse doc 4's delete-guard pattern.)

- **Benchmark (beat this):** Gong — score a call / scorecard setup — https://help.gong.io/docs/score-a-call . *What we like:* per-call-type scorecards with typed, AI-answerable criteria.
- **Build docs:** internal — `Scorecard` + `ScorecardCriterion` (below); versioning on edit.

## Journey 9.9 — Scorecard usage: score a call & review over time [LATER, needs multi-user]

*As a manager (or the AI reviewer), I want to score a rep's call and review scores over time, so that coaching is grounded in consistent, comparable data.*

1. **Score a call** — on a call record (doc 6), the manager opens the matching scorecard and fills each criterion; the result saves as a `ScorecardResult` pinning the schema `version`, the `callId`, and the `repId`.
2. **AI reviewer** — for `ai_evaluated` criteria, the intelligence layer (doc 6) answers from the transcript automatically (model = doc 6's brief model, **`claude-sonnet-5`**, backend-selectable); `scoredById = null` marks an AI-scored result. A human can override any AI answer.
3. **Review stats** — a rep's scores are reviewed over time, splitting **leading KPIs** (activities: calls, emails, meetings-set) from **lagging KPIs** (outcomes: meetings booked, opps created, revenue), per rep. (The reporting surface is doc 5b; this journey is the scorecard-specific read.)

- **Benchmark (beat this):** Gong — score a call — https://help.gong.io/docs/score-a-call ; Ambition — rep scorecard (leading vs. lagging KPI split) — https://ambition.com/blog/what-is-a-sales-rep-scorecard . *What we like:* Gong's AI-answered criteria; Ambition's leading/lagging framing.
- **Build docs:** internal — `ScorecardResult` (below); AI-answered criteria via doc 6.

---

## Background jobs

### F-DEAL1 — Recompute deterministic warnings (Tier A)

**Trigger — event-driven on relevant new activity, debounced ~60s.**

*What "relevant new activity" means (the concrete event set):* a **logged call**, an **inbound or outbound email**, a **meeting booked or held**, a **stage change**, a **contact added/removed on the deal**, or an **amount / close-date edit**. It **excludes** events that can't change a Tier-A warning (a typed note, a field edit unrelated to any warning), so we don't recompute for nothing.

*Why event-driven (options weighed):*
- **(a) Event-driven, debounced (chosen for Tier A).** Tier-A warnings are cheap rules; recomputing the instant the underlying fact changes keeps the board **fresh** (an inbound reply clears "Ghosted" immediately). Debounced ~60s so a burst of activity (a call that lands with its transcript, disposition, and follow-up email at once) coalesces into one recompute.
- **(b) Nightly batch only.** Rejected for Tier A — a warning that's up to 24h stale is misleading on an operating board (the rep sees "Ghosted" after the prospect already replied).
- **(c) Lazy on-read.** Rejected as the *primary* trigger — it can't drive the "Needs attention" filter or card badges without loading every deal, and it recomputes repeatedly on each view. *(We do a lightweight on-open recompute as a safety net.)*

Writes the current warning set per deal. (Reuses the pg-boss runner, doc 12. pg-boss: a `deal-warnings` queue, `singletonKey = dealId`, `singletonSeconds = 60` for the debounce, `retryLimit: 3`, `retryBackoff: true`.)

### F-DEAL2 — Run AI risk skills (Tier B)

**Trigger — a blend, deliberately *not* per-activity:**
- **On new transcript/email content** for a deal (that's when new judgment signal appears) — enqueue a Haiku triage; if it flags a material change, run the Sonnet risk pass.
- **Nightly** for every open deal (catches time-based risks like "promised-but-didn't-send" and "missed deadline" that fire from the *passage* of time, not an event).
- **On-demand** when the rep opens the deal detail and taps **Refresh risks** (cached otherwise).

*Why not per-activity like F-DEAL1:* Tier-B inference is **expensive** (a Sonnet pass over the full timeline) and **noisy if run constantly** — risks would flip-flop on every touch. Gating on *new content + nightly + on-demand* balances freshness against cost and stability. Writes `DealRisk` rows (title, evidence, confidence, status); only rows above the confidence threshold surface. (pg-boss: `deal-risk-ai` queue, `singletonKey = dealId`, `retryLimit: 2`; nightly sweep via `pgboss.schedule` cron `0 2 * * *`.)

### F-DEAL3 — Recommended-next-action refresh

When warnings or risks change (fired by F-DEAL1 / F-DEAL2), pick the play from the highest-priority open risk and **pre-draft the copilot execution** so the card's next action is ready (Journey 9.5). (Reuses doc 7 H1.)

### F-DEAL-snapshot — Point-in-time deal snapshots

**This is doc 5b's nightly `PipelineSnapshot` job (F4-snapshot), reused, not a new job.** It appends one row per open deal per night `(dealId, stageId, amount, closeDate, snapshotAt)`, powering the waterfall (9.7) and the % change toggles (9.6). *(The old doc-9 `DealSnapshot` model was removed to avoid duplicating doc 5b's table — see the data-model note.)*

---

## Decisions for you (deal board & forecasting)

**1. No risk *score* — surface discrete, evidence-grounded risks instead. Decided (your call, my agreement).** A single 0–100 number asserts false confidence, hides *why*, and has no corpus to justify it at launch. We split risk into **Tier A deterministic warnings** (reliable, factual) and **Tier B AI-surfaced risks** (judgment, inference over the timeline, each with cited evidence and a confidence gate). *Alternative — the old weighted-rules score — rejected: reps distrust a number they can't unpack, and it blends reliable and unreliable signals into one misleading figure.*

**2. Tier-B risks are customizable natural-language skills. Decided (my pick).** Following Decagon/Fin, each judgment risk is a plain-language skill a workspace can edit, threshold, or disable — because the "said-vs-CRM" mapping differs per company/object type and can't be a fixed rule. *Alternative — hard-coded risk rules — rejected: brittle across object types, and impossible for a workspace to tune to its own sales motion.*

**3. Forecast = amount × per-stage probability. Decided (your simplification).** A transparent, editable stage-weight setting replaces forecast categories and the submission workflow. Weighted value shows per deal / per column / overall, with optional period deltas. *Alternative — Salesforce-style forecast categories + submission — deferred: heavier, and the stage weight gives a solo rep an honest number now. Team submission/rollup is [LATER] (doc 11).*

**4. What's [LATER].** **Now (single-user):** board, ownership="Me", closed-won/lost handling, warnings, AI risks, multi-threading, timeline, next-action, stage-weighted forecast, waterfall entry point. **[LATER] (multi-user):** multi-owner/team/manager filters, team forecast rollup, scorecards. The model is built now so teams become a rollup.

---

## Technology choices (where it is not obvious)

- **Risk = two tiers, no score.** Tier A: rules over structured activity/CRM (cheap, event-driven, reliable). Tier B: AI skills over the deal timeline (judgment, evidence-grounded, confidence-gated, customizable). We do **not** blend them into a number — discreteness is what keeps them trustworthy and actionable.
- **Tier-B model — `claude-sonnet-5` with a `claude-haiku-4-5` triage.** Judgment over long context wants a reasoning model; a cheap Haiku pre-pass decides which deals changed enough to warrant it. Backend-selectable (docs 4g/6/7).
- **Forecast — a `winProbability` on each pipeline Stage + weighted sums.** A stored, editable per-stage probability (not derived, not a separate category field) — the simplest transparent model. Period deltas reuse `PipelineSnapshot`.
- **Reuse existing engines** — doc 4.9 kanban, doc 4a activity feed, doc 4c view filters, doc 5b's `PipelineSnapshot`, doc 7 copilot. This doc adds a warnings-rules table, the risk-skill + `DealRisk` tables, and a stage `winProbability` field — little new infrastructure.

## Data model (Prisma) — additions in this doc

Extends the CRM schema. **New models marked `// NEW`.** Deals are generic `Record`s (doc 4); risk-score fields were **removed** this round.

```prisma
// Deal object attributes (stored in Record.valuesJson):
// Deal: ...(existing: name, companyId, peopleIds[], stageId, amount, closeDate, ownerId)
//   — REMOVED this round: forecastCategory, riskScore, riskFactorsJson (no more 0–100 score)

// PipelineStage (model in doc 4; kanban config in doc 4c 4.9) GAINS:
//   winProbability : Int 0..100   // stage weight for the forecast (Journey 9.6); seeded, editable in Settings → Pipeline

model DealWarningConfig {    // NEW — per Tier-A warning: enable + threshold (Journey 9.2)
  id          String  @id @default(cuid())
  workspaceId String
  warningKey  String         // no_activity | ghosted | stalled | overdue | no_next_meeting |
                             // single_threaded | no_power
  enabled     Boolean @default(true)
  thresholdJson Json         // { days: 7 } or { minContacts: 2 } etc.
  @@unique([workspaceId, warningKey])
}

model DealRiskSkill {        // NEW — a customizable natural-language Tier-B risk skill (Journey 9.2)
  id          String  @id @default(cuid())
  workspaceId String
  objectType  String         // which deal-object variant this applies to (mapping differs per company type)
  riskKey     String         // missed_deadline | promised_not_sent | timeline_mismatch |
                             // stakeholder_mismatch | competitor_late | pricing_not_discussed | no_next_step
  name        String
  promptMd    String         // the plain-language definition the workspace can edit (Decagon/Fin model)
  minConfidence Float @default(0.7)  // surface only above this
  enabled     Boolean @default(true)
  isDefault   Boolean @default(false)
  @@unique([workspaceId, objectType, riskKey])
}

model DealRisk {             // NEW — one AI-surfaced risk instance on a deal, with evidence (Journey 9.2)
  id           String   @id @default(cuid())
  workspaceId  String
  dealId       String
  riskKey      String
  title        String        // "Prospect's stated timeline (Q1) contradicts Close Date (Jun 30)"
  evidenceJson Json          // { sourceType: call|email|note, sourceId, quote }
  confidence   Float         // model confidence 0..1
  status       String   @default("open") // open | dismissed | resolved
  dismissReason String?
  detectedAt   DateTime @default(now())
  @@index([workspaceId, dealId, status])
}

// PipelineSnapshot: defined in doc 5b (job F4-snapshot). REUSED here for the waterfall (9.7)
// and the % change toggles (9.6). No DealSnapshot model — it was removed to avoid duplicating 5b.

model Scorecard {            // NEW [LATER] — a versioned scorecard schema (Journey 9.8)
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  callType    String?
  version     Int     @default(1)
  criteria    ScorecardCriterion[]
  isArchived  Boolean @default(false)
}

model ScorecardCriterion {   // NEW [LATER] — one typed question on a scorecard (Journey 9.8)
  id          String @id @default(cuid())
  scorecardId String
  label       String
  kind        String         // scale_1_3 | boolean | ai_evaluated
  sortOrder   Int
}

model ScorecardResult {      // NEW [LATER] — a filled scorecard on a call (manager or AI) (Journey 9.9)
  id          String   @id @default(cuid())
  scorecardId String
  scorecardVersion Int        // pin the version so old scores stay interpretable
  callId      String
  repId       String
  scoredById  String?        // null = AI reviewer
  answersJson Json           // { criterionId: value }
  total       Int?
  createdAt   DateTime @default(now())
  @@index([repId, createdAt])
}
```

## Technical decisions, trade-offs & edge cases

**Why no score, and why two tiers (Journey 9.2).** A composite score forces reliable facts (overdue, single-threaded) and unreliable judgments (tone, said-vs-CRM) into one number, so the number is only as trustworthy as its weakest input — and reps can't tell which. Splitting them keeps the reliable warnings crisp and forces every judgment risk to **show its evidence**, which is the only thing that makes a judgment risk safe to act on.

**Controlling Tier-B false positives.** The failure mode of an AI risk feed is crying wolf — one bad flag and reps ignore all of them. Three guards: (1) every risk must **cite a quote**; a risk with no groundable evidence is dropped. (2) A **confidence threshold** per skill (default 0.7), workspace-tunable. (3) **Prefer false negatives to false positives** in the default prompts ("if unsure, do not fire"). We accept missing some risk to keep the feed trusted.

**What we deliberately can't do (stated to avoid false confidence).** No win-probability number; no risk from tone alone; most field-by-field "bad CRM update" mismatches beyond the high-value timeline/stakeholder/competitor ones are deferred (low value, error-prone) — matching Gong's own low-value defers. If a fact was never discussed (e.g. budget), we don't invent a risk about it.

**Snapshot reuse (Journeys 9.6, 9.7).** The waterfall and the % change toggles both need to diff the pipeline at two points in time, which the live `Deal` table can't do. Rather than a second `DealSnapshot`, we **reuse doc 5b's `PipelineSnapshot`** (append-only, nightly, one row per open deal). Same table, one job, built once.

**Next-action singularity (Journey 9.5.1).** When several warnings/risks fire, exactly one action is shown, chosen by a fixed priority over the risk catalog, so the rep is never handed a pile. Resolving that risk re-runs F-DEAL3 and the next-highest surfaces.

**Scorecard versioning (Journey 9.8).** Schemas change but old scores must stay interpretable, so `ScorecardResult` pins `scorecardVersion` and edits **bump the version** rather than mutating criteria in place — a little duplication for stable historical comparison.
