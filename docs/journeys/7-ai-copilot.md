# Doc 7 — AI Copilot (the map)

This is the **map** of the app's AI. The core loop is simple: **the rep talks, the AI proposes the next action, the rep clicks accept.** Everything AI in the app sits in **three layers** — *Surfaces* (where a rep meets the AI), *Engines* (the shared machinery every surface reuses), and *Data* (facts from outside). This doc holds the map plus the flagship surface (the post-call stack, 7.1 / 7.2); every other feature has its own doc.

## The AI, in three layers

| Layer | Feature | Doc |
|---|---|---|
| **Surface** | Post-call action stack + talk-and-accept | **this doc** (7.1 / 7.2) |
| **Surface** | Structured notes (was "qualification") | [7h](7h-structured-notes.md) |
| **Surface** | Ask (Q&A over a call or an account) | [7j](7j-ask.md) |
| **Surface** | AI fields & columns | [7i](7i-ai-fields.md) (grid view: [4g](4g-crm-ai-columns.md)) |
| **Surface** | Data-chat agent (writeable, global) | [7e](7e-agent-surface.md) |
| **Surface** | Chrome extension (page context) | [7g](7g-chrome-extension.md) |
| **Surface** | Call & meeting intelligence | [2a](2a-dialer-call-ai.md) · [6](6-call-intelligence.md) · [6a](6a-meeting-video-intelligence.md) |
| **Engine** | Decision / event engine ("open loops") | [7c](7c-ai-decision-engine.md) (recipes: [7b](7b-copilot-automations.md)) |
| **Engine** | Skills library | [7f](7f-skills.md) |
| **Engine** | Provenance (the trust layer) | [7k](7k-provenance.md) |
| **Engine** | Eval fixtures | [7a](7a-copilot-eval-fixtures.md) |
| **Engine** | AI platform (models, cost, guardrails, framework) | [7l](7l-ai-platform.md) |
| **Data** | Enrichment | [7d](7d-enrichment.md) |

**The mental model:** a rep touches a **Surface** → it runs on the **Engines** → sometimes pulling outside **Data**.

**Global rules** (full detail in [7l](7l-ai-platform.md)): the **model is super-admin-set** (no per-user picker; three tiers Haiku / Sonnet / Opus); **every AI value keeps its provenance** ([7k](7k-provenance.md)); **internal writes are automatic, external actions are queued for approval** ([7c](7c-ai-decision-engine.md)).

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the technical page.

---

## Journey 7.1 — After a call, accept the next actions

*As a rep, I want a ready list of next actions the moment I hang up, so I act on the call without retyping anything.*

The core loop. Benchmarked on **Salesloft Rhythm** (the canonical match — an AI-prioritized, editable action stack), **Intercom Fin** (the accept/edit/reject interaction), and **Talkdesk / Genesys wrap-up** (review pre-filled disposition + follow-ups); plus Superhuman/Gong.

**The shape — answering your 10 questions:**
1. **A ranked STACK, not one-at-a-time.** A rep finishing a call has 3–6 things to do; show them ranked. (One-at-a-time fits only atomic Gmail-chip suggestions.)
2. **Cards are PRE-FILLED with drafted content** — the full email, the task, the field diffs — not just titles. This is the biggest adoption lever.
3. **Latency: first card < 1s, full stack < 3–5s**, streamed in as ready — never block on the whole stack.
4. **Yes — populate BEFORE the call ends.** Live transcription (C2) pre-stages commitments/follow-ups mid-call, so the stack feels **ready the instant he hangs up**, then finalizes on end.
5. **Collapsed by default with a 1–2 line PREVIEW** of the draft; expand to the full editor on click. (Six fully-open drafts overwhelm; bare titles hide the value.)
6. **Words for the primary action** ("Send", "Save to CRM"); **icons for secondary** (pencil = edit, × = dismiss). Bare icons on irreversible actions cause hesitation.
7. **Controls are PER-CARD** — each element is a distinct real action with its own recipient/content/risk. A per-stack **"Accept all"** exists as a secondary affordance, but the unit of decision is the card.
8. **A large DOCKED panel, not a corner widget** — this is his primary post-call surface (the copilot rail as a right rail / main pane), never a floating toast that hides content.
9. **Accept performs it NOW, with a 5–10s undo** — not queue-until-end (that adds a forgettable second commit and breaks "did it send?").
10. **No cross-stack DB transaction — you're right, overkill.** Actions are heterogeneous and independently valuable (a sent email can't be rolled back anyway). **Partial success is correct:** if the CRM write fails, the email still sends. Use **per-action idempotency + retry + a visible per-card status** (pending / done / failed), not a distributed transaction.

**Cards-first, with a chat rail (your "chat vs cards" instinct).** The stack is **structured cards** because each action has typed fields to edit and its own Send button — chat can't show six editable drafts cleanly, and free-text "yes do #2" is ambiguous under time pressure. But a **chat/command rail sits alongside** for revision and overflow: *"make the email shorter," "add a task to call Friday," "also update the other contact at this account," "why did you suggest this?"* — that last is exactly your "do something we didn't propose" case. **Cards for the proposed actions; chat for anything else.**

1. He hangs up and dispositions; the **copilot rail** fills with the ranked, pre-filled stack (**H1** drafted it during the call).
2. **Per-card controls:** **Accept** (Enter), **Edit** (Tab), **Reject/Dismiss** (Esc) — Intercom's model, with words on the primary buttons.
3. **Edit opens the right editor for that action type, *in place* — we don't build new editors.** Which editor for which card is the **card-type table below**; each renders **embedded** in the expanded card (never a navigate-away). Anything not covered by a card → the **chat rail**.
4. **Accept performs it** through the *same* action code the manual UI uses (H6, idempotent), with a 5–10s undo.
5. **Reject, logging, reversibility, provenance — your 7.1.5 questions, precisely:**
   - **Where it's logged:** every accept/edit/reject writes a **`CopilotAction`** row (proposal id, verb, who, when, `performedRef` = what it created).
   - **How the user reads it:** an **Activity → Copilot log** view (and the account timeline) shows plain English — "Proposed follow-up email · edited · sent", "Proposed stage = At risk · rejected" — each linking to the proposal and result.
   - **How "reverse" works:** **undo** reverts the created thing (deletes the draft task/event, restores the prior field value); a **sent email cannot be un-sent** — which is exactly why Accept opens a composer one keystroke from send, not auto-send.
   - **Provenance (fixing my confusing wording):** each drafted value carries a small **source chip**; clicking it jumps to **the exact timestamped moment in the call transcript it was drawn from** — that's what I clumsily called "transcript line X." Full trust layer = [7k](7k-provenance.md).
   - **Yes we capture accept/edit/reject provenance (who + when) — and it's valuable for evals:** the **edit-rate and reject-rate per proposal type** is a direct AI-quality signal we log; a heavily-edited or often-rejected type flags a model/prompt to fix.

**Stack UX details (answering the remaining stack questions):**
- **Keyboard-expand each card (your 7.1.5 ask).** Cards are collapsed to a 1–2 line preview; **J/K** move focus between cards, **Space** (or **→**) expands the focused card to its full editor, **Esc** (or **←**) collapses it, and **Tab** inside an expanded card cycles its fields. So the rep can tab through and expand each card in turn without a mouse.
- **Configurable undo window (your "change the duration" ask).** The 5–10s undo is a **workspace setting** (Settings → Intelligence → Copilot), adjustable **5–30s**, or set to **"require an explicit confirm instead of a timer"** for cautious teams; irreversible action types can override to always-confirm. Spec: `Workspace.copilotUndoSeconds` (default 8).
- **The chat/command rail — what it looks like (your "picture it" ask).** A slim input **pinned to the bottom of the copilot rail**, below the stack, always focusable by typing or **/** (commands). It handles revisions ("make it shorter"), overflow actions the stack didn't propose, and "why did you suggest this?".
  ```
  ┌── Copilot ──────────────┐
  │ ▸ Follow-up email   Send │  ← ranked stack cards (collapsed)
  │ ▸ Task: call Fri    Save │
  │ ▸ Stage → At risk   Save │
  │ ──────────────────────── │
  │ 💬 make the email shorter│  ← command rail, pinned bottom
  └──────────────────────────┘
  ```
  **Benchmark (beat this):** the **cards + rail** layout is well-benchmarked — **Claude Code** [visual: the to-do list + collapsible tool-call rows sitting above the prompt input](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously) ; **Intercom Fin Copilot** [visual: sidebar AI answer + cited sources + "Add to composer" actions feeding the reply rail](https://www.intercom.com/help/en/articles/8587194-how-to-use-copilot) ; plus **Attio "Ask Attio"** (chat rail beside a record) — https://attio.com/platform/ai ; **Superhuman "Ask AI"** (keyboard-first command input) — https://superhuman.com/ai . *(Older links replaced: the Superhuman blog homepage had no screenshot; `linear.app/docs/command-menu` 404s — the Linear menu now lives at its [changelog screenshot](https://linear.app/changelog/2019-12-18-new-command-menu).)* **The only genuinely new bit:** our specific composition — a **post-call stack of *editable, sendable* action cards** paired with a **revision rail** ("make it shorter / why this?"); the layout itself is borrowed, not invented.
- **Edit does NOT navigate away (resolving your split-pane / tabs / popups question).** Editing a card opens the right editor **in place, as a focused side-editor that splits the rail** — the editor on one side, the person/record card still visible on the other — so the rep keeps context mid-call and never loses his place. Chosen over: (a) navigating to a full editor page (breaks call flow), (b) tabs (tab sprawl with 6 actions), (c) separate popup windows à la Gmail compose (fine for one email, chaotic for a stack). The composer / task / calendar editors render **embedded** in that side-editor, not as a new route; **close** returns to the stack. *(Requirement this creates: every editor must be an **embeddable component**, not only a full-page route or popup. Where an earlier doc specced an editor only as a route/popup, it must also render inline.)*

**What each card type looks like (your ask — collapsed → expanded → which editor's journey):**

| Card type | Collapsed preview | Expanded (embedded editor) | Editor's journey |
|---|---|---|---|
| **Send email** | recipient + subject + 1-line body | the **email composer** | doc 5.5 |
| **Send SMS** | recipient + 1-line text | the **SMS composer** | doc 3a |
| **Create task** | title + due date | the **task editor** | doc 4d |
| **Create meeting / invite** | title + time + attendees | the **calendar draft** | doc 5.6 |
| **Field update / stage change** | `field: old → new` | the **inline field editor** | doc 4b |
| **Make a call / call task** | "call {name} {when}" | the **dialer / call task** | doc 2 |
| **Disposition** | the chosen disposition + note | the **disposition control** | doc 2 |
| **Create other record** | object + key fields | the **record create form** | doc 4 |

*Worked example (your case):* a **"Send email"** card is collapsed to recipient + subject; the rep presses **Space** → it expands to the **composer (doc 5.5) embedded in the card**, pre-filled; he edits and hits **Send** right there — he never left the stack.

- **Benchmark (beat this):** Salesloft Rhythm — https://www.salesloft.com/platform/rhythm ; Intercom Fin Copilot (Tab/Esc accept-reject) — https://www.intercom.com/help/en/articles/8587194-how-to-use-copilot ; Talkdesk Copilot (post-call wrap-up) — https://www.talkdesk.com/cloud-contact-center/omnichannel-engagement/copilot/
- **Build docs:** Claude tool use (each action is a tool) — https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview ; reuses the existing editors (docs 5.5 / 4.14 / 5.6).

## Journey 7.2 — The talk-and-accept loop

*As a rep, I want to clear my post-call actions with the keyboard, so I move to the next call in seconds.*

This is the Superhuman-speed core: one proposal on screen at a time, chosen for him, cleared with one key.

Clear the post-call stack with the keyboard, then advance to the next call.

1. The ranked stack from 7.1 is on screen. **Keyboard-first:** **Enter** accepts the focused (top) card and moves to the next; **Tab** edits; **Esc** dismisses; **J/K** move between cards; typing goes to the focused card's edit field. Mouse optional.
2. **Ranking (clarified — and yes, it belongs here, since it's what makes the stack keyboard-clearable).** The copilot orders the stack so the single most-likely action is **card #1** — one Enter clears it. It ranks from **call state** (dispositioned? follow-up promised?) and **record state** (deal stage, open tasks, last touch). The ranking runs inline as part of H1 (this doc); it is the same ordering the decision engine reuses when it feeds items in ([7c](7c-ai-decision-engine.md)).
3. When the stack is cleared, the loop **advances to the next call/record** (in power dial, the next dial). Nothing blocks; dismissing is instant.
4. The **chat rail** is always there for anything the stack didn't propose (7.1).
5. **Visual feedback on accept/reject (your question).** **Accept** → the card shows a brief green check, then **slides out to the right and fades** (~150ms) and the stack **reflows upward** so the next card takes the top slot — clean exit, so it's obvious it's done. **Reject/Dismiss** → the card **collapses in place and fades** (no slide), quieter than an accept. **A failed action does NOT vanish** → the card stays with a red **"failed — retry"** status ([7.1](7-ai-copilot.md) decision 10), so nothing silently disappears. Motion respects reduced-motion settings (instant, no slide).

- **Benchmark (beat this):** Salesloft Rhythm — [visual: video/GIF demos of Focus Zones + the AI-ranked next-best-action workflow](https://www.salesloft.com/platform/rhythm) + [how it works (Plays: signal → task)](https://www.salesloft.com/platform/rhythm/plays) ; Superhuman — Instant Reply (keyboard model) — https://help.superhuman.com/hc/en-us/articles/46005583725709-Instant-Reply
- **Build docs:** Claude tool use — how it works — https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works

## Journey 7.3 — Review and accept a qualification extraction

**→ Moved to [7h — Structured Notes](7h-structured-notes.md).** Renamed from "qualification" and generalized (objections, call summary, action items too); it is now its own object related to the record + the source call, so a deal can carry several.

## Journey 7.3a — Configure qualification templates (CRUD)

**→ Moved to [7h — Structured Notes](7h-structured-notes.md)** (Journey 7h.6/7h.7). The template editor is generalized there (qualification / objections / summary / action-items / custom); `QualificationTemplate` is renamed `StructuredNoteTemplate`.

## Journey 7.4 — Chat with your data (and change it)

**→ Moved to [7e — The Data-Chat Agent](7e-agent-surface.md).** Chat-with-your-data and change-data-from-chat now live there, with the agent's placement per context, the tool/API contract, sessions, skills-as-chips, reasoning/tool-call display, and mid-run controls.

## Journey 7.5 — Q&A over one transcript, or one account's whole history

**→ Moved to [7j — Ask](7j-ask.md).** Q&A over one call or a whole account, fully specced (where the box is, system prompt, tools, model, and question-type fixtures).

## Journey 7.6 — AI fields (note summary + rolling account summary)

**→ Moved to [7i — AI Fields & Columns](7i-ai-fields.md).** Merged with the grid version ([4g](4g-crm-ai-columns.md)) — same feature (a value the AI computes from the row).

## Journey 7.7 — Enrichment agents (beat Clay)

**→ Moved to [7d — Enrichment](7d-enrichment.md).** Sources, the per-field waterfall, keys (ours/BYOK), BYO steps, the manual-button map, array fan-out vs composite cells, company logos, cost + accuracy monitoring, the signal/web/list/deep-research agents, and the three scenarios are all specced there as journeys.

## Journey 7.8 — Turn a good result into a reusable skill

**→ Moved to [7f — The Skills Library](7f-skills.md).** What a skill is (markdown + optional scripts + schema + golden set), where its code runs, authoring (incl. the metadata nudge), evals, and the built-in skills live there.

## Journey 7.9 — Check the source of any AI value (the trust layer)

**→ Moved to [7k — Provenance (the trust layer)](7k-provenance.md).** Given its own shared Engine doc, because every AI surface uses it — not just enrichment.

## Journey 7.10 — Give the agent the page I'm looking at (browser context)

**→ Moved to [7g — The Chrome Extension](7g-chrome-extension.md).** Page context, the on-demand tool-call model, and why the extension is not persistently connected.

## Journey 7.11 — The agent knows my screen, and can change my settings

**→ Moved to [7e — The Data-Chat Agent](7e-agent-surface.md).** Screen/recent-action context and changing settings by chat (via the accept path) live there.

## Journey 7.12 — Post-call coaching [LATER — backlog]

**→ Moved to the backlog ([14](14-backlog.md)).** Post-call coaching is parked (complex, easy to get wrong); it rides call-intelligence + the eval'd skill library when built.

## Background jobs (this doc — the stack)

- **H1 — Generate next-action proposals.** Trigger: call disposition. Draft the ranked email / invite / task / field-update stack from the transcript + record state (`claude-sonnet-5`). Runs inline for latency; a proposal on screen within ~1–2s.
- **H6 — Perform accepted actions.** Trigger: an accept with a side effect (send email, write field). Execute idempotently (keyed by `proposalId`, so a double-press can't act twice) and stamp provenance ([7k](7k-provenance.md)). Immediate.

*(Other jobs moved with their features: enrich H2 → [7d](7d-enrichment.md); AI-field recompute H3 → [7i](7i-ai-fields.md); signal research H4 → [7d](7d-enrichment.md); skill runs H5 → [7f](7f-skills.md); decision-engine DE-* → [7c](7c-ai-decision-engine.md).)*

## Data model (this doc — the post-call stack)

*(Cross-cutting models moved with their features: `Provenance` → [7k](7k-provenance.md); `AiFieldDef` → [7i](7i-ai-fields.md); `StructuredNote`/`StructuredNoteTemplate` → [7h](7h-structured-notes.md); `EnrichmentRun`/`EnrichmentSource` → [7d](7d-enrichment.md); `Skill`/`SkillRun` → [7f](7f-skills.md); `ChatThread`/`ChatMessage` → [7e](7e-agent-surface.md); `OpenLoop`/`AiPermissionRule` → [7c](7c-ai-decision-engine.md). Models, cost, framework, and guardrails → [7l](7l-ai-platform.md).)*

```prisma
model Proposal {              // NEW — a next-action the copilot offers (Journeys 7.1/7.2)
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  callId      String?         // the call it came from (H1), if any
  recordId    String?         // the record it acts on
  type        String          // email | meeting | task | disposition | field_update | record_write
  rank        Int    @default(0) // loop order; 0 = the single next step
  payload     Json            // drafted content: subject/body, invite, task, field diffs
  status      String @default("pending") // pending | accepted | edited | rejected | performed
  createdAt   DateTime @default(now())
}

model CopilotAction {         // NEW — the log of every accept/edit/reject (reversible)
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  proposalId  String?
  verb        String          // accept | edit | reject | undo
  performedRef Json?          // what it created: emailMessageId, taskId, eventId, field writes
  undoneAt    DateTime?
  createdAt   DateTime @default(now())
}
```
