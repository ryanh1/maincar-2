# Doc 7k — Provenance (the trust layer)

Part of the **AI Copilot** family — an **Engine** (shared machinery every surface reuses). See the map in [7 — AI Copilot](7-ai-copilot.md). This **replaces the old Journey 7.9** and gives it its own home, because provenance is used by **everything** — the post-call stack ([7.1](7-ai-copilot.md)), structured notes ([7h](7h-structured-notes.md)), AI fields ([7i](7i-ai-fields.md)), Ask ([7j](7j-ask.md)), the data-chat agent ([7e](7e-agent-surface.md)), the decision engine ([7c](7c-ai-decision-engine.md)), and enrichment ([7d](7d-enrichment.md)) — not just one of them.

**The rule.** **Every value an AI writes carries its source.** A field the model wrote with **no `Provenance` row is a bug** — the write path refuses it. This is what lets a human trust, check, and later distrust any AI value, and it makes a super-admin model swap auditable.

**The interaction is well-benchmarked; only the AI-source *content* is new.** The pattern — a small marker in a cell/field → click → a popover with details — is exactly how **Google Sheets** shows a **cell comment** (a corner triangle → popover) and a **cell's edit history** (right-click → *Show edit history* → a who/when/what popover you page through). The **accept/dismiss** card is exactly Grammarly's inline suggestion. What no product puts in that popover is **AI-source semantics** — *which* call moment, *which* provider, *which* model produced the value, with verify/reject. So we don't invent the UI shell (we borrow Google Sheets' cell-marker+popover, Grammarly's accept/dismiss, and Glean's "jump to the exact source moment"); we put **AI provenance inside it**.

Under each journey: **Benchmark (beat this)** = the product to match. **Build docs** = the technical page.

---

## Journey 7k.1 — See where an AI value came from

*As a rep, I want to see where any AI-written value came from, so I can trust it before I rely on it.*

1. Anywhere an AI wrote a value, a small **source chip** shows on the field (a subtle sparkle/underline, not a loud badge).
2. Click it → a **popover** (not a modal): one plain-English line ("Set from the Aug 12 call with Dana, 14:32"), the **evidence snippet** quoted, a **"View source" deep link** (jump to the transcript moment / open the cited page), model + confidence in small text, and two buttons: **Verify** and **Reject/Edit**.
   ```
   Mobile:  +1 586 842 3670  ˚          ← the ˚ is the source chip (a subtle sparkle after the value)
                             └───────────────────────────────┐
                              Set from the Aug 12 call w/ Dana, 14:32
                              “…my cell is five eight six…”      (evidence snippet)
                              PDL · 0.92 conf · ↗ View source
                              [ Verify ]   [ Reject / Edit ]
                             └───────────────────────────────┘
   ```
- **Benchmark (beat this):** the **chip → popover interaction** — **Google Sheets cell edit history** [visual: the *Show edit history* popover with editor/timestamp/what-changed + paging arrows] — https://www.howtogeek.com/730304/how-to-see-the-edit-history-of-a-cell-in-google-sheets/ and **Google Sheets cell comments** [visual: corner-triangle indicator → comment popover] — https://www.howtogeek.com/736056/how-to-collaborate-with-comments-in-google-sheets/ ; the **accept/dismiss card** — **Grammarly** inline suggestion — https://support.grammarly.com/hc/en-us/articles/360003474732-Grammarly-Editor-user-guide ; the **jump-to-source** — **Glean** deep-linked citations — https://developers.glean.com/guides/chat/deep-linked-citations . **The only genuinely new bit:** AI-source semantics *inside* the popover (call moment / provider / model + verify/reject) — the shell is borrowed. **Build docs:** the `Provenance` model (below).

## Journey 7k.2 — Verify a value

*As a rep, I want to confirm a value is right, so it's marked trusted for later.*

1. Click **Verify** in the popover → value unchanged; status → **verified**; the chip becomes a quiet **✓**; the provenance row is kept for audit.
- **Build docs:** `Provenance.status = verified`.

## Journey 7k.3 — Reject / correct a value

*As a rep, I want to reject a wrong AI value and fix it in one gesture, and have the mistake remembered, so it doesn't come back.*

1. **The value:** cleared or reverted to the previous value, with an **inline edit** so he types the correct value in the same gesture.
2. **The UI:** the chip flips to a neutral **human-owned** state; AI styling removed; the field is now **user-authoritative**, so future AI/enrichment won't silently overwrite it.
3. **The stored record:** never hard-deleted — the provenance row is kept with **status = rejected, rejected-by, timestamp, and the rejected value**. That becomes a **feedback signal for evals** ([7a](7a-copilot-eval-fixtures.md)/[7f.8](7f-skills.md)) and an audit trail, and it **suppresses re-suggesting the same value from the same source**.
- **Key principle:** reject **corrects the field but preserves the evidence trail** — that audit history *is* the trust layer, and it's what none of the benchmarks give at field level.
- **Build docs:** `Provenance.status = rejected` + suppression.

---

## Data model
```prisma
model Provenance {            // NEW — one row per AI-written value (used by every AI surface)
  id            String   @id @default(cuid())
  workspaceId   String
  targetType    String          // record_field | structured_note_slot | ai_field | enrichment | chat_write
  targetId      String          // id of the written thing
  value         Json?           // the value written
  previousValue Json?           // what it overwrote (for revert on reject)
  source        String          // transcript_line | web_citation | chat | enrichment_provider | ai_field
  sourceRef     Json            // {url} | {callId,startMs} | {instruction} | {provider}
  evidenceSnippet String?       // the exact quoted text/moment it was drawn from
  confidence    Float?
  skillId       String?
  modelUsed     String          // super-admin-set model at write time (auditable on a model swap)
  promptVersion String?         // for eval attribution
  status        String   @default("unverified") // unverified | verified | rejected
  statusBy      String?
  statusAt      DateTime?
  userId        String?         // who accepted it
  createdAt     DateTime @default(now())
  @@index([targetType, targetId])
}
```

## Cross-doc references preserved
Replaces the old **Journey 7.9**. Used by: post-call stack [7.1](7-ai-copilot.md), structured notes [7h](7h-structured-notes.md), AI fields [7i](7i-ai-fields.md), Ask [7j](7j-ask.md), the agent [7e](7e-agent-surface.md), the decision engine [7c](7c-ai-decision-engine.md), enrichment [7d](7d-enrichment.md). A rejected value feeds evals [7a](7a-copilot-eval-fixtures.md).
