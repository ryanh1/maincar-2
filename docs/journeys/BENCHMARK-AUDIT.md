# Benchmark audit — every journey doc

*Audit date: 2026-08-19. Covers all 43 docs that contain journeys, **451 numbered journeys**.*

> **Snapshot warning.** Other sessions are editing these docs right now — `7-ai-copilot.md` moved
> from 5 to 11 un-benchmarked journeys while this audit was being written. Re-run the counting
> commands at the bottom before acting on an exact number.

> **Status — Parts B and A(7c) are done.** The counts in the scoreboard below are the *original*
> findings, kept so the audit still reads as a record of what was wrong. Current state after the
> two fix passes:
>
> | Check | Audit | Now |
> |---|---|---|
> | No benchmark at all | 92 | **62** |
> | Marketing-page-only links | 51 | **24** |
> | Bare doc-root links | 6 URLs / ~20 journeys | **0** |
>
> Fixed so far: **P1 items 1–4** in full (7c's 30 journeys, the six root links, the dialer
> help-centre swap, the Clay split). Still open: **P2** (the per-doc missing table) and **P3**
> (the 53 named-but-unlinked benchmarks). The suggested order at the bottom picks up at step 4.

**What this checks.** Doc 1 states the rule: a benchmark is *"the product to match, plus a link
where you can **see** how it works (screenshots, the user journey, what the features do)."*
This audit grades every journey against that rule and against the newer, stronger convention
introduced in [7h](7h-structured-notes.md) / [7i](7i-ai-fields.md) / [7k](7k-provenance.md).

---

## The standard (from 7h / 7i — apply this everywhere)

A good benchmark line names the product, says **which part** of it we are matching, and gives
**up to two links**:

```
- **Benchmark (beat this):** Attio — AI attributes [visual] — <link that shows screens>
  + [how it works] — <link that describes fields, steps, or the data model> ;
  Clay — Claygent column [visual walkthrough] — <link> + [how it works] — <link>.
```

Three rules fall out of that:

1. **Name the aspect.** "Attio — record pages" is too broad. "Attio — record pages *(the section
   ordering + drag-to-reorder)*" is a benchmark you can grade against.
2. **`[visual]` is required for a visual feature.** A grid, a card, a player, a rail, a menu — if
   we have to draw it, we need a picture of theirs.
3. **`[how it works]` is required for a mechanism.** A schema, a matching rule, a retry policy, a
   permission resolver — if we have to build logic, we need their fields and steps, not a
   marketing claim.

When neither exists, say so explicitly, the way 7h.1 and 7k already do:
*"**Open gap to beat (no visual benchmark):** …"*. A stated gap is a valid answer. Silence is not.

---

## Scoreboard

| Check | Count | Share |
|---|---|---|
| Journeys audited | 451 | — |
| **No benchmark at all** | **92** | 20% |
| Benchmark named, **no link** | 53 | 12% |
| Benchmark links are **marketing pages only** (no screens, no spec) | 51 | 11% |
| One URL doing duty for **3+ different journeys** | 28 URLs | — |
| Uses the `[visual]` / `[how it works]` convention | 2 docs (7h, 7i) | 5% |

Your 80/20 estimate was close. Roughly **75%** of journeys are fine as-is. The failures cluster
hard — they are not spread evenly, so a small number of docs carry almost all the debt.

---

## P1 — Fix these first

### 1. Doc 7c has 30 journeys with no benchmark line — ✅ FIXED

[7c-ai-decision-engine.md](7c-ai-decision-engine.md) — journeys 7c.1–7c.32, all but 7c.15.

**This is not really missing research.** The research exists and is good:
[docs/ideas/decision-engine-benchmarks.md](../ideas/decision-engine-benchmarks.md) is a 35-product
study with 89 links. The problem is that it is organized by **Factor** (1–7), not by journey, so
no journey carries its own bar.

**Fix:** map each journey to its factor and paste the specific product + link onto the journey.
The mapping is nearly mechanical:

| Journeys | Factor in the research doc |
|---|---|
| 7c.1–7c.11 (triggers) | Factor 1 — Entry points |
| 7c.12–7c.13 (gate, five moves) | Factor 2 — What the AI computes |
| 7c.14, 7c.15, 7c.24 (loops, escalation, auto-close) | Factor 4 — Reminder / re-inference |
| 7c.16–7c.20, 7c.27, 7c.30 (approval, permission grid, earned autonomy) | Factor 3 — Permission & approval |
| 7c.28 (skills) | Factor 5 — Instruction authoring |
| 7c.32 (traces) | Factor 6 — Cost & usage |
| 7c.1, 7c.18 (live call) | Factor 7 — Live-call inference |

7c.27 (the permission grid) and 7c.17 (away-queue + digest) are the two that most need a
**`[visual]`** link — they are screens we have to draw, and the research doc is text-only.

### 2. Bare doc-root links that point at nothing specific — ✅ FIXED

These are links in name only. A reader cannot see the feature from them.

| Link | Used by |
|---|---|
| `https://linear.app/docs` | 1a.2, 1a.8, 1b.2, 1b.5, 4b.12 |
| `https://attio.com/help` | 1.7, 1a.8, 1b.1 |
| `https://www.clay.com/university` | 7d.1, 7d.7, 7d.9, 7d.18, 7d.21 |
| `https://www.helicone.ai/` | 13a.1, 13a.3, 13a.7 |
| `https://www.nooks.ai/` | 2.6 (doc 2a), 3.4a, 3.9 (doc 3b) |
| `https://www.braintrust.dev/` | 7f.5, 7f.8 |

**Fix:** deep-link to the exact page. Clay in particular already has real docs used elsewhere in
the same file (`university.clay.com/docs/…`, `university.clay.com/lessons/…`) — 7d just needs the
per-journey page instead of the university landing page.

### 3. The dialer family benchmarks marketing pages, not help centers — ✅ FIXED

Docs [2](2-dialer-calling-core.md), [3](3-dialer-at-scale.md),
[3a](3a-dialer-numbers-sms-compliance.md), [3b](3b-dialer-analytics.md),
[3c](3c-inbound-ivr-and-routing.md) lean on `phoneburner.com/power-dialer`,
`nooks.ai/ai-dialer`, `aircall.io/call-center-software-features/`, `kixie.com/features/…`,
`orum.com/platform/dialer`. Several journeys already admit the problem in the text
("*marketing page — limited screenshots*").

These are all **visual** journeys — the call screen, the IVR builder, the power-dial rhythm, the
ring-group config. A marketing page is the wrong source for every one of them.

**Fix — the same vendors' help centers, which this repo already uses elsewhere:**

| Journey | Currently | Use instead |
|---|---|---|
| 3.4, 3.4c, 3.4d, 3.5 | `phoneburner.com/power-dialer` | PhoneBurner support center article per behavior |
| 3.15, 3.19, 3.13c | `aircall.io/…features/` | `support.aircall.io/hc/…` (already used for 3.13, 3.13a, 3.13b) |
| 3.16, 3.17, 3.18, 3.14b | `kixie.com/features/…` | `support.kixie.com/hc/…` (already used for 3.18's FAQ) |
| 3.20 | `orum.com/platform/dialer` | `support.orum.com/en-US/orum/…` (already used for 3.8) |
| 2.5, 2.4, 2.4c, 3b.9, 3.4 | `nooks.ai/…` | Nooks help center pages — `support.nooks.ai` does exist, so the gap fallback was not needed |

Where a help centre genuinely does not exist (Nooks and Trellus are thin — 2.6 says so honestly),
keep the marketing link for the *concept* and **add an explicit "no visual benchmark" line**, so
the build knows it is inventing rather than matching.

### 4. Clay is one link doing six different jobs — ✅ FIXED

`https://www.clay.com/claygent` benchmarks 4g.1, 4g.2, 4g.6, 7d.6, 7d.17, 7d.19 — prompt
variables, run state, internals, an agent source, citations, and deep research. Those are six
different bars.

**Fix:** split per journey. 7i.1 already shows how — it pairs an
`arcade.software` interactive walkthrough (**visual**) with a `university.clay.com` lesson
(**how it works**). Copy that shape into 4g and 7d.

---

## P2 — Missing benchmarks, by doc

Each of these journeys has no benchmark line. Grouped by what they need.

### Needs a real benchmark (a competitor does this — we just did not cite one)

| Doc | Journeys | Suggested direction |
|---|---|---|
| [4b](4b-power-views-editing-and-keyboard.md) | 4b.5, 4b.5.1, 4b.5.2 (dropdown colors + display labels) | Airtable single-select **[visual]** + Notion select properties; the parent journeys inherited nothing while 4b.5.3 got the link |
| [4b](4b-power-views-editing-and-keyboard.md) | 4b.7, 4b.7.1, 4b.7.2, 4b.7.3 (`@`/`/` commands) | Notion slash + `@` menus **[visual]**; Linear inline mentions; Google Sheets in-cell date picker. 4b.7.4 has these — the siblings need their own slice |
| [4b](4b-power-views-editing-and-keyboard.md) | 4b.10, 4b.11, 4b.11.1, 4b.13 | Section parents with linked children — either inherit explicitly or say "see child journeys" |
| [4c](4c-crm-tables-views-lists.md) | 4.8 (set up a table view) | Airtable "creating and configuring views" — the children all cite Airtable already |
| [7](7-ai-copilot.md) | 11 journeys, incl. 7.4, 7.7, 7.8, 7.10, 7.11 | These are now owned by 7e / 7d / 7f / 7g — either point at the child doc's benchmark or delete the stub |
| [7d](7d-enrichment.md) | 7d.10, 7d.12, 7d.13, 7d.20, 7d.22, 7d.24 | Clay bulk-run + credits dashboard; Clearbit/PDL reverse lookup for 7d.13 |
| [7f](7f-skills.md) | 7f.6, 7f.7, 7f.9 | Claude skills docs (already the benchmark for 7f.2–7f.4) |
| [7h](7h-structured-notes.md) | 7h.3, 7h.4, 7h.5, 7h.7 | Gong AI Data Extractor + Attio insight templates, sliced per action (finalize / multiple / relate / CRUD) |
| [7i](7i-ai-fields.md) | 7i.2, 7i.4 | Airtable AI field run state **[visual]**; Attio AI attributes recompute rules **[how it works]** |
| [9](9-deal-board-and-forecasting.md) | 9.5, 9.5.2 | Clari Inspect / Gong Engage — 9.5.1 and 9.5.3 have them, the parent and the algorithm do not |
| [11](11-multiuser-teams-and-permissions.md) | 11.5, 11.6 | Pointer journeys — add "benchmarks live in 11a / 11.6.1–3" |
| [8](8-developer-platform.md) | 8.7 (scopes) | Stripe restricted API keys + Slack OAuth scopes **[how it works]** |
| [3a](3a-dialer-numbers-sms-compliance.md) | 3.14c, 3.14c.1, 3.14c.2 | Twilio Lookup + error-code taxonomy **[how it works]**; 3.14c.3 already cites it |
| [6](6-call-intelligence.md) | 6.1a (speaker identification) | Gong speaker identification / Recall.ai participant events **[how it works]** |
| [7b](7b-copilot-automations.md) | 7b.3 (conditional reminders) | Superseded by 7c — link forward or delete |
| [7e](7e-agent-surface.md) | 7e.12 · [7g](7g-chrome-extension.md) 7g.3 | Same feature in two docs; both need the ChatGPT Atlas / Clay extension citation 7g.1 has |
| [7j](7j-ask.md) | 7j.2 · [7k](7k-provenance.md) 7k.2 | Attio research agent / Glean citations — siblings have them |

### Correctly has no benchmark (internal algorithm — leave alone, but say so)

[4](4-crm-data-and-views.md) 4.2-impl-note, 4.S1, 4.S2, 4.S3, 4.I1, 4.I2 — seeding, backfill and
integrity sweeps are our own machinery. **Add one line each: "*No external benchmark — internal
algorithm.*"** so a reader knows it was considered, not forgotten. 7d.8, 7d.14, 7d.26 are the same
case (reference tables and explainers, not journeys).

---

## P3 — Benchmark named but no link (53 journeys)

Every one of these names a product from memory with nothing to click. The heaviest clusters:

- **[13](13-superadmin-console.md) — 9 of 10 journeys.** "Stripe Dashboard", "Linear admin",
  "AWS Console" with no URL. Stripe's docs are public and screenshot-rich; this is cheap to fix.
- **[13b](13b-superadmin-model-and-killswitches.md)** — 13b.2, 13b.6.
- **[7b](7b-copilot-automations.md) — 7 journeys** (7b.4–7b.9, 7b.11) cite internal doc numbers
  only ("the 7.1 stack", "internal"). Internal cross-references are fine as the *build* pointer,
  but they are not a benchmark. Each still needs an outside bar or a stated gap.
- **[4g](4g-crm-ai-columns.md)** — 4g.3, 4g.4, 4g.5, 4g.7.
- **[1a](1a-account-workspace-and-profile-settings.md)** — 1a.3, 1a.9, 1a.12, 1a.13 cite Loadwire
  internals plus "Linear settings" with no link. The Loadwire half is legitimately internal; the
  Linear half needs a URL.

Full list: run
`grep -n "Benchmark" docs/journeys/*.md | grep -v http` .

---

## Also worth fixing

**Over-broad reuse.** Beyond Clay above, these single URLs each cover 4–6 unrelated journeys and
should be sliced by aspect:

- `attio.com/…/configure-record-pages` → 4.3, 4a.1, 4a.7, 4a.9, 4b.11.2, 4.11 (doc 4d)
- `help.gong.io/docs/intro-to-the-call-page` → 2.9, 6.2, 6.4, 6.8, 6a.1
- `attio.com/…/records-lists-and-views` → 3.2, 3.4a, 3.4b, 3.14d
- `support.google.com/docs/answer/181110` (Sheets shortcuts) → 4b.2, 4.8.5, 4f.3, 4f.7

**Good models to copy.** These already meet the bar and are the pattern for the rest:
7i.1, 7h.1, 7h.2, 7k.1 (visual + how-it-works split) · 4.7 and 4.17 (*"split by aspect"*) ·
9.2 (benchmark laid out in full before the design) · 2.6 (states honestly that the vendor's docs
are thin) · 4.8.8 and 4g.1/4g.8 (a **YouTube walkthrough** as the visual — the most reliable
`[visual]` source when a help centre has no screenshots).

---

## Suggested order of work

1. ~~**7c** — 30 journeys, research already done, purely a re-attachment job.~~ ✅ done
2. ~~**Bare-root links** — 6 URLs, ~20 journeys, mechanical.~~ ✅ done
3. ~~**Dialer help-centre swap** — docs 2 / 3 / 3a / 3b / 3c, ~15 journeys.~~ ✅ done
4. **P3 no-link cluster** — doc 13 (9), 7b (7), 4g (4), 1a (4).
5. **P2 missing** — the per-doc table above.
6. **Convention sweep** — roll `[visual]` / `[how it works]` out from 7h/7i to every doc.

---

## Re-run the counts yourself

The hand-rolled scripts below are superseded by the checker, which encodes these
rules plus four more and gates CI:

```bash
npm run check:journeys -- --all
```

`scripts/journey-lint-baseline.json` holds the accepted backlog — the same debt this
audit describes. Clearing a P2/P3 row should shrink that file
(`npm run check:journeys -- --update-baseline`). The procedure for writing a journey
so it never lands in there is `.claude/skills/journey-specs/SKILL.md`.

### The original one-off script

```bash
python3 - <<'EOF'
import re,glob
files=[f for f in sorted(glob.glob("docs/journeys/*.md")) if "INDEX" not in f and "AUDIT" not in f]
t=m=0
for f in files:
    L=open(f).read().split("\n")
    idx=[(i,l) for i,l in enumerate(L) if re.match(r'^#{2,3} +Journey ',l)]
    for n,(i,l) in enumerate(idx):
        e=idx[n+1][0] if n+1<len(idx) else len(L); t+=1
        if not [x for x in L[i:e] if 'enchmark' in x]:
            m+=1; print("NO BENCHMARK:",f,l.strip('# ')[:70])
print("journeys",t,"missing",m)
EOF
```
