# Doc 7f — The Skills Library

Part of the **AI Copilot** family (head: [7 — AI Copilot](7-ai-copilot.md)). A **skill** is a saved, reusable instruction the AI can run — "find a mobile," "draft the follow-up," "research to sell," "what good follow-up looks like." This doc was **split out of the old Journey 7.8**. Skills are used everywhere: the decision engine ([7c](7c-ai-decision-engine.md)) runs them on events, the agent ([7e](7e-agent-surface.md)) runs them from chat, AI columns ([4g](4g-crm-ai-columns.md)) run them per row, enrichment ([7d](7d-enrichment.md)) research steps are skills.

**Benchmark for the whole model: Anthropic Agent Skills / Claude Code Skills** — a `SKILL.md` markdown file with a short front-matter header, loaded only when relevant, optionally bundling scripts — https://code.claude.com/docs/en/skills and https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills . We match that model and add **evaluation** (a golden test set + a no-regression gate) and **CRM-native invocation**.

Under each journey: **Benchmark (beat this)** = the product to match. **Build docs** = the technical page.

---

## What a skill is (read this first — answers 7.8.7)

A skill is a small **folder**, exactly like a Claude Code skill:
- **`SKILL.md`** — markdown instructions with a short **front-matter header** (a `name` and a one-line `description`; optional: which objects/events it applies to, the model tier, whether it may search the web).
- **An optional output schema** — the JSON shape it writes (so results are typed and validated before they touch a record).
- **Optional bundled `scripts/`** — real code the skill can run (e.g. a Python script to normalize phone numbers, query a report, or parse a file) — for the deterministic parts where code beats a prompt.
- **Optional `references/`** — extra markdown the AI reads only when needed.
- **A golden test set** — ~50 real records with hand-verified expected outputs, used to score the skill (7f.8).

**Progressive disclosure (why it scales):** only each skill's `name` + `description` sits in the AI's context at rest; the full `SKILL.md` body loads **only when the skill is judged relevant**; bundled `references/` and `scripts/` load **only at the moment of use**. So a workspace can have hundreds of skills without bloating any single run. (This is exactly Anthropic's model — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills .)

## Where a skill's code runs (answers 7.8.7 — execution + dependencies)

A skill's bundled scripts run in a **sandboxed code-execution environment** (an isolated container per run, no access to other workspaces' data), the same way Claude Code runs a skill's script in a sandbox and the Claude API runs skills in a hosted code-execution sandbox — https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool . **Dependencies:** the sandbox ships with a standard toolkit (Python + common libs: pandas/numpy/requests); a skill declares any extra dependency in its front-matter (`dependencies: [...]`) and we install it into that run's sandbox. Scripts run **off-context** — their code and large I/O never enter the model's context window, only the result does. **If a script errors or times out (then):** the run surfaces the error in the tool card ([7e.8](7e-agent-surface.md)) and the skill falls back to a prompt-only path where possible.
- **Model tiers (guidance point 17):** a skill's front-matter sets a tier — default `claude-haiku-4-5` for high-volume mechanical skills (find-mobile, dedupe), `claude-sonnet-5` for judgment-heavy ones (research-to-sell, draft-follow-up). Super-admin can override globally.

---

## Journey 7f.1 — Turn a good result into a reusable skill (create-from-result)

*As a rep, I want to save a flow that just worked so I can repeat it forever, so I earn trust once and reuse it.*

1. **Entry.** The rep **asks** for something on a record in chat ([7e](7e-agent-surface.md)): *"Find the VP of Sales and their mobile."*
2. The agent **asks clarifying questions** (which title exactly? mobile only, or any phone? — 7e.10) and **returns results for 1–3 records**, proposing the **fields + formatting** it would write.
3. He **comments or accepts**; comments loop back and refine the run.
4. Once he likes it, a **"Save as skill"** button (in the run's header) opens the skill editor **pre-filled** from the run: the instruction becomes the `SKILL.md` body, the proposed fields become the output schema, the clarifying answers become defaults.
5. He confirms a **name** and **description** (7f.3 nudges these), and **Save** adds it to the library.
- **Benchmark (beat this):** Clay — Claygent Builder (save a working run as a reusable step) — https://university.clay.com/docs/claygent-builder . **Build docs:** `Skill` model (doc 7).

## Journey 7f.2 — Create a skill from scratch (create)

*As an admin, I want to author a skill directly, so I can encode a workflow before anyone runs it ad hoc.*

1. **Entry.** **Settings → Intelligence → Skills → + New skill.**
2. A **skill editor** opens — a two-pane view like the Claude app's skill editing: **left = the `SKILL.md` markdown** (with a live-rendered preview), **right = settings** (name, description, applies-to objects/events, output schema, model tier, web on/off, dependencies).
3. He writes the markdown, optionally **attaches a script** (upload or paste into `scripts/`), defines the output schema, and **Save**.
- **Benchmark (beat this):** Claude app — skill create/edit (markdown + metadata) — https://code.claude.com/docs/en/skills . **Build docs:** the skill editor over the `Skill` model.

## Journey 7f.3 — The metadata nudge (answers 7.8.5)

*As an author, I want the app to make sure my skill has a good name and description, so the AI can find and pick it correctly.*

Because a skill is only **discoverable by its `name` + `description`** (progressive disclosure), a weak description means the AI never loads the skill. So, exactly like Claude nudges you to write good skill metadata:
1. On save, if the **description is missing or vague** (too short, no trigger words), the editor shows an inline nudge: *"A clear description helps the AI know when to use this skill. Describe what it does and when to use it."* — with a **✨ Suggest** button that drafts a description from the skill body (`claude-haiku-4-5`).
2. The nudge is **advisory, not blocking** — he can save anyway — but the skill list shows a small "needs a better description" flag until fixed.
- **Benchmark (beat this):** Claude — skill metadata authoring guidance. **Build docs:** a lint rule on `Skill.description`.

## Journey 7f.4 — Browse, read, and search the library (read)

*As a rep, I want to see what skills exist and read exactly what one does, so I trust it before I run it.*

1. **Entry.** Settings → Intelligence → **Skills**: a browsable list (built-ins + saved), each row showing **name · description · applies-to · last eval score** (7f.8) · on/off.
2. **Read one.** Click a skill → its **`SKILL.md` rendered as markdown** (like reading a skill in the Claude app), plus its schema, scripts, model tier, and eval history. Search filters by name/description/body.
- **Benchmark (beat this):** Claude app — view a skill's markdown. **Build docs:** markdown render of `Skill.spec`.

## Journey 7f.5 — Edit and version a skill (update)

*As an author, I want to edit a skill and not silently break it, so improvements don't cause regressions.*

1. **Entry.** A skill → **Edit** → the same editor (7f.2).
2. On **Save**, the skill is **versioned** (old versions kept), and the change is **eval-gated**: it runs against the golden set and **blocks the save if quality drops** below the prior version (7f.8). **If it regresses (then):** the editor shows which fixtures failed and offers "save anyway (override)" for an admin.
- **Benchmark (beat this):** Braintrust — playgrounds vs experiments (iterate loose, then snapshot a version you can diff) [how it works] — https://www.braintrust.dev/foundations/playgrounds-vs-experiments ; Braintrust — prompt versioning practice — https://www.braintrust.dev/articles/what-is-prompt-versioning . **Build docs:** version rows + the eval gate.

## Journey 7f.6 — Delete or share a skill

*As an admin, I want to remove a stale skill or share a good one, so the library stays useful.*
1. **Delete.** Skill → ⋯ → Remove (soft-delete; recoverable). **If any event binding or AI column uses it (then):** warn and list them first (no dangling references).
2. **Share.** A skill is **workspace-scoped**; sharing across workspaces/teams is **[LATER]**. A rep's personal skill can be **promoted to the workspace** by an admin.
- **Build docs:** `Skill.workspaceId`; binding checks.

## Journey 7f.7 — Invoke a skill (usage)

*As a rep, I want to run a skill on one record or a whole selection, so I apply it at any scale.*

1. **From chat / command bar:** type **`/find-mobile`** (a chip, [7e.7](7e-agent-surface.md)); it runs on the current record or a named selection.
2. **From a table:** as an **AI column** ([4g](4g-crm-ai-columns.md)) with **▶ play one** / **Run on selection**.
3. **On events:** bound to a trigger by the decision engine ([7c.29 / 7b.1](7c-ai-decision-engine.md)).
4. A run over a selection is **Background job H5** on the durable runner (retries; minutes for big batches); results stream in with provenance.
- **Build docs:** `SkillRun` (doc 7); job H5.

## Journey 7f.8 — Evals: keep skills good and stop regressions

*As the company, I want each skill measured against a golden set so it improves and can't silently regress.*

1. **Each skill has a golden test set** — ~50 real Person/Company records (or event fixtures) with **hand-verified expected outputs** (the enrichment/chat fixtures in [7a](7a-copilot-eval-fixtures.md) are the shared starter set; each new skill ships its own).
2. **On any edit** (7f.5), we **run it against its golden set and score it** — match-rate/precision for typed outputs, **LLM-as-judge** (`claude-sonnet-5`) for fuzzy ones — and **gate the change on not regressing**.
3. **A real production miss** (a human **reject** of a value, [7k](7k-provenance.md)) can be **added to the golden set** as a permanent test case, so the same mistake can't return.
4. Each skill shows its **last eval score** in the library.
- **Benchmark (beat this):** Braintrust — evaluate systematically (datasets, scorers, per-case regression) [how it works] — https://www.braintrust.dev/docs/evaluate ; Promptfoo — assertions & metrics — https://www.promptfoo.dev/docs/configuration/expected-outputs/ ; Promptfoo — CI/CD quality gate — https://www.promptfoo.dev/docs/integrations/ci-cd/ . **Build docs:** eval runner over `Skill` + golden sets; feeds [7a](7a-copilot-eval-fixtures.md).

## Journey 7f.9 — Built-in skills (ship day one)

*As a rep, I want useful skills available immediately, so the library isn't empty on day one.* — ~13 defaults, each a real `SKILL.md` with a golden set:
Find mobile · Find the decision-maker · Verify email · Company snapshot · Recent news · Job-change watch · Hiring signal · Find look-alikes · Draft follow-up · Dedupe check · Fix formatting · Research to sell ([7d.19](7d-enrichment.md)) · Classify persona ([7d.8](7d-enrichment.md)). Plus the **internal "good follow-up" skill** used by the decision engine ([7c.13](7c-ai-decision-engine.md)) — this one lives in our own instructions and is **not user-editable** (though users can add their own on top).
- **Build docs:** seed `Skill` rows with `isBuiltIn = true`.

## Skills master table (answers 7b.1.2 — "a table defining all skills + what they do + output")

| Skill | What it does | Output | Model tier | User-editable? |
|---|---|---|---|---|
| Find mobile | Waterfall to a contact's mobile | phone (E.164) + provenance | `claude-haiku-4-5` | yes |
| Find the decision-maker | Find the VP/Director for a role + their contact info | person + role + contact | `claude-haiku-4-5` | yes |
| Verify email | Is this email valid/deliverable? | boolean + reason | `claude-haiku-4-5` | yes |
| Company snapshot | Fill firmographics (size/industry/revenue/tech) | company fields + provenance | `claude-haiku-4-5` | yes |
| Recent news | Latest funding/product/leadership news, cited | list of dated, cited items | `claude-sonnet-5` | yes |
| Job-change watch | Detect when a contact changes company | signal event (dated, cited) | `claude-haiku-4-5` | yes |
| Hiring signal | Roles an account is hiring for | list of roles (cited) | `claude-haiku-4-5` | yes |
| Find look-alikes | Source companies similar to a given account | new list of companies | `claude-sonnet-5` | yes |
| Draft follow-up | A follow-up email from the last call transcript | email draft (queued) | `claude-sonnet-5` | yes |
| Dedupe check | Flag likely duplicates in a selection | pairs + confidence | `claude-haiku-4-5` | yes |
| Fix formatting | Normalize phones/titles/casing on a selection | field writes | `claude-haiku-4-5` | yes |
| Research to sell | Deep multi-source signal brief ([7d.19](7d-enrichment.md)) | cited brief + buying signals | `claude-sonnet-5` | yes |
| Classify persona | Set a person's persona from title/enrichment | persona enum + provenance | `claude-haiku-4-5` | yes |
| *(internal)* Good follow-up | Defines "what good follow-up looks like" for the decision engine ([7c.13](7c-ai-decision-engine.md)) | judgment guidance (no user output) | `claude-sonnet-5` | **no** (ours; users add their own on top) |

---

## Background jobs
- **H5 — Skill run.** Trigger: a `/`-command, an AI-column run, or an event binding, over a record selection. Durable runner, retries, minutes for big batches.
- **Eval run.** Trigger: any skill edit (7f.5) or a nightly sweep. Runs the golden set, scores, gates. `claude-sonnet-5` for LLM-as-judge.

## Data model
Reuses `Skill` and `SkillRun` (doc 7). `Skill.spec` holds the `SKILL.md` body + front-matter + output schema + script refs; add `Skill.version`, `Skill.lastEvalScore`, and a `SkillGolden` set (recordIds + expected outputs).

## Cross-doc references preserved
Replaces the old **Journey 7.8**. Related: decision engine [7c](7c-ai-decision-engine.md), agent [7e](7e-agent-surface.md), AI columns [4g](4g-crm-ai-columns.md), enrichment research steps [7d](7d-enrichment.md), provenance [7k](7k-provenance.md), eval fixtures [7a](7a-copilot-eval-fixtures.md).
