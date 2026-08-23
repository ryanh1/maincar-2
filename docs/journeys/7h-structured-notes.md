# Doc 7h — Structured Notes

Part of the **AI Copilot** family — a **Surface** (where a rep meets the AI). See the map in [7 — AI Copilot](7-ai-copilot.md). This **replaces the old "qualification extraction" journeys (7.3 / 7.3a)** and generalizes them.

**What this doc covers.** A **structured note** is a set of fields the AI **fills in from a conversation** — a call transcript, a meeting, or an email thread — following a **template**. "Qualification" (MEDDPICC / BANT / CHAMP) is just *one* kind of template; the same machine also does **objection handling**, a **call summary**, **action items**, or anything you define. That's why it's renamed from "qualification" to **structured notes**: the old name was too narrow (objections and summaries aren't qualification).

**The key reframe (answers your object-model question).** A structured note is **its own lightweight object** (`StructuredNote`), **related to a record** (a deal, a person, or an account) **and to the source conversation**. So a deal **can have several** (a MEDDPICC note + an objections note + a summary), and a note **can relate to any record**. A **template** defines which fields (slots) get filled — that's how we know what the fields should be.

**Models are super-admin-set** ([7 global rule](7-ai-copilot.md)); the extraction runs on **`claude-sonnet-5`** (accuracy matters for structured extraction), schema-locked. The extraction **jobs** are the calling-core jobs C2b/C3 (reused, not redefined).

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the technical page.

---

## The object model (read this first)

```prisma
model StructuredNote {          // NEW — a filled set of AI-extracted fields
  id            String   @id @default(cuid())
  workspaceId   String
  templateId    String          // -> StructuredNoteTemplate (which slots)
  recordId      String          // the deal / person / account it's about
  recordType    String          // deal | person | company | ...
  sourceCallId  String?         // the conversation it was extracted from (if any)
  slots         Json            // [{key, label, value, status, evidenceRef}] — each value backed by Provenance (7k)
  status        String @default("draft") // draft | final
  createdAt     DateTime @default(now())
  updatedAt     DateTime @default(now())
  @@index([workspaceId, recordId])
}

model StructuredNoteTemplate {   // NEW — was QualificationTemplate; generalized
  id            String  @id @default(cuid())
  workspaceId   String
  name          String          // "MEDDPICC" | "Objection handling" | "Call summary" | custom
  kind          String          // qualification | objections | summary | action_items | custom
  slots         Json            // ordered [{key, label, extractionPrompt, fieldType}]
  isBuiltIn     Boolean @default(false)
  appliesWhen   Json?           // reuse calling-core Journey 2.7 apply rules (campaign / stage / participants)
}
```

- Because a note is its own object, **multiple notes per record** and **relating a note to other records** both fall out for free (they're just rows with a `recordId`).
- Each filled slot's value carries **provenance** ([7k](7k-provenance.md)) — the exact call moment it came from.

---

## Journey 7h.1 — Structured notes fill in as you talk

*As a rep, I want a template's fields to fill themselves in as I talk on a call, so I accept them instead of typing notes after.*

1. **Entry point.** A **Structured notes** panel in the **copilot rail** (the docked rail beside the call, [7](7-ai-copilot.md)) during and after a call, and on the **record** (deal/person). It shows the applied template's slots, each filling as the model hears it.
2. Each filled slot is **editable before finalizing**; an empty slot reads **"not mentioned,"** never a guess (the hallucination guardrail, [7k](7k-provenance.md)).
3. A template can also be an **objections** template (it lists the objections raised + how they were handled) or a **summary** template (a one-paragraph recap) — same panel, different template.
4. **Autosave & drafts (your browser-close concern):** every edit **autosaves to a draft** continuously — nothing is lost if he closes the browser. **"Finalize" marks it final.** An un-finalized note shows a **"Draft" badge** on the panel and the record; dispositioning the next call auto-finalizes the current one so the loop never stalls.
- **Benchmark (beat this):** the **filled structured-fields panel** — **Gong "Ask Anything"** [visual: a MEDDIC-framework analysis + summary generated from a call] — https://www.gong.io/blog/gong-on-gong-expedite-call-review-process-ask-anything ; **Attio Call Intelligence** [visual: Insights/Summary tabs with populated fields — decision-maker, migration timeline, seats — and a filled SPICED template] — https://attio.com/platform/call-intelligence ; **Otter** [visual: summary + action items] as a near-benchmark. **The only genuinely new bit:** the fields **filling live as the rep talks** — the benchmarks populate *post-call* (Attio markets "real-time" but the confirmed visuals are the near-call populated panel). **Build docs:** reuses extraction jobs C2b/C3; the `StructuredNote` model above; `claude-sonnet-5`, schema-locked structured output — https://platform.claude.com/docs/en/build-with-claude/structured-outputs .

## Journey 7h.2 — Where the panel is, and how long forms behave

*As a rep, I want the panel to fit the rail and stay readable even for a long framework, so I'm never scrolling a wall of fields.*

1. **Placement.** The **Structured notes** tab in the copilot rail (same docked rail as the post-call stack), on the **call panel** during/after the call, and on the **record** page.
2. **Long forms.** The panel scrolls within the rail; **filled slots collapse to one line**; on a narrow width it stacks single-column; on the full record page it can expand to **two columns**. It never overflows the rail.
- **Benchmark (beat this):** Attio — insight-template UI [visual: sections + prompts + preview] — https://attio.com/help/reference/productivity-collaborating/call-intelligence/create-insight-templates-for-call-recordings . **Build docs:** the rail panel component.

## Journey 7h.3 — Finalize (accept) a structured note

*As a rep, I want to accept the note once, so the fields land on the record.*

1. He reviews the filled slots, edits any, and clicks **Finalize** → `status = final`; the values write to the record (or stay on the note object, related to the record), each with provenance ([7k](7k-provenance.md)).
2. **If he dispositions the next call before finalizing (then):** the current note auto-finalizes so nothing stalls.
- **Build docs:** the accept path shared with [7c](7c-ai-decision-engine.md) / [7.1](7-ai-copilot.md).

## Journey 7h.4 — Several structured notes on one record

*As a rep, I want a deal to carry more than one structured note — MEDDPICC and objections and a summary — so each captures a different lens.*

1. On the record, a **Structured notes** section lists each note as a row: **template name · source call · date · draft/final**. Click to expand.
2. Multiple templates can apply to the same call (a MEDDPICC note + an objections note), each written as its own `StructuredNote` row.
- **Doc 7 tag:** this is the generalization of the old single "qualification" panel. **Build docs:** `StructuredNote` rows keyed by `recordId`.

## Journey 7h.5 — Relate a structured note to another record

*As a rep, I want to attach a structured note to a person as well as the deal, so the insight lives where it's relevant.*

1. A note's overflow menu → **Relate to…** picks another record; the note then shows on both (it's a related object, so this is a normal relation — doc 4a).
- **Build docs:** reuses CRM relations (doc 4a).

---

# Config: the templates (CRUD)

## Journey 7h.6 — Create a structured-note template

*As an admin, I want to define which fields the AI fills and how, so extractions match how we sell (or what we want to track).*

1. **Entry.** **Settings → Intelligence → Structured-note templates** (grouped with the 2.7 summary/extraction templates). **MEDDPICC / BANT / CHAMP / Objection handling / Call summary / Action items ship as built-in defaults;** he can clone-and-edit or build a custom one.
2. **Create:** name it, pick a **kind** (qualification / objections / summary / action_items / custom), add **ordered slots**; per slot a **label**, an **extraction prompt** ("What metric did they cite?"), and a **field type**.
3. **Field types:** default **short text**; also **long text**, **single-select** (dropdown options), **yes/no**, **date**, **number/currency**. Guidance: *"text unless you'll actually report on it"* (dropdowns/yes-no earn their place by making slots comparable and reportable).
4. **Live preview** in the sidebar shows the template exactly as the rep will see it, updating as he edits.
5. **Which template applies to which calls:** reuse the 2.7 apply rules (campaign, deal stage, participants); one org default.
- **Benchmark (beat this):** Gong — AI Data Extractor (typed fields) — https://help.gong.io/docs/ai-data-extractor ; Attio — insight templates [visual] — https://attio.com/help/reference/productivity-collaborating/call-intelligence/create-insight-templates-for-call-recordings . **Build docs:** reuses the calling-core Journey 2.7 field-set editor; `StructuredNoteTemplate`.

## Journey 7h.7 — Read / edit / delete a template

*As an admin, I want to view, tweak, and retire templates, so the set stays useful.*
- **Read:** the templates list (name · kind · built-in? · applies-when). **Edit:** the same slot editor (7h.6). **Delete:** soft-delete; **if any structured notes were created from it (then):** they're kept (the fields already landed), the template is just retired.
- **Build docs:** `StructuredNoteTemplate` CRUD.

---

## Background jobs
- **Extraction (reused C2b/C3, calling-core).** Trigger: `call.transcript.chunk` (live, fills slots) + `call.ended` (finalizes). Schema-locked `claude-sonnet-5`. Writes `StructuredNote.slots` + a Provenance row per slot ([7k](7k-provenance.md)). Empty → "not mentioned," never invented.

## Cross-doc references preserved
Replaces the old **Journeys 7.3 / 7.3a**. Related: the post-call stack [7.1/7.2](7-ai-copilot.md), provenance [7k](7k-provenance.md), the decision engine [7c](7c-ai-decision-engine.md) (a structured note can open a follow-up loop), eval fixtures [7a](7a-copilot-eval-fixtures.md).
