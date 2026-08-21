# SPEC — Computed / Formula Fields (Formula Engine)

*Companion deep-dive broken out of [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md) module **R10** (§13 flagged it as the hardest subsystem). Owns the formula field: syntax, the library, parsing, dependency tracking + recalc, type handling, error UX, and security. No bespoke language, no raw `eval`.*

---

## 1. What a formula field is

A **computed field** is a field whose value is a **formula over other fields**, evaluated when the record changes or at query time. It lets reports and tables show derived numbers (margin, days-open, weighted value) without exporting to a spreadsheet.

**Entry point.** **Settings → Computed fields → + New**, or, on any object, add a field of type **Formula**.

1. Name the field, pick the object, write a formula in **spreadsheet-familiar syntax** referencing other fields by name:
   `=(Amount - Cost) / Amount` · `=IF(Stage="Won", Amount, 0)` · `=DAYS(Now(), CreatedAt)`
2. Autocomplete lists the object's fields + available functions.
3. A **live preview** evaluates against a sample record and flags errors before save.
4. The field then behaves like any field: shows in tables, is a **dimension/measure in the pivot** ([R2](SPEC-REPORTING-ENGINE.md#r2--pivot-builder--advanced-metrics--drill-through-v1)), and recomputes when its inputs change.

---

## 2. Library choice — `@formulajs/formulajs` + `jsep` (decided)

**We use a proven spreadsheet-formula library, not a query language and not raw JavaScript.** Business users know `SUM`/`IF`/`VLOOKUP`; a formula library is **safe by construction** (no arbitrary code execution).

- **[@formulajs/formulajs](https://github.com/formulajs/formulajs)** — MIT, ~400 Excel-compatible functions as plain JS. The function vocabulary.
- **[jsep](https://github.com/EricSmekens/jsep)** — MIT, a tiny expression parser that turns the user's formula string into an **AST** we evaluate against a record's fields.
- **Rejected: HyperFormula** — richer (built-in dependency graph + auto-recalc) but **GPLv3-or-commercial**, a poor fit for a closed-source product; and we don't need its spreadsheet-cell model.
- **Raw/user JavaScript is out.** If we ever must run user JS, it goes in an **`isolated-vm`** sandbox — never `eval`, never the deprecated `vm2`.

**Why not just `eval`:** `eval` executes arbitrary code with app privileges — a catastrophic injection surface. formulajs + jsep only ever evaluates a fixed, allowlisted function set against named field values.

---

## 3. Architecture — string → AST → evaluate

```
formula string  ──jsep──►  AST  ──walk──►  evaluate
  "=(Amount-Cost)/Amount"          │           │
                                   │           ├─ field ref → resolve from the record's values
                                   │           ├─ function call → formulajs (allowlisted subset)
                                   │           └─ operator → safe arithmetic (÷0 → error value)
                                   └─ referencedFields[] extracted at save (for recalc)
```

1. **Parse once at save** with jsep → AST. Reject a formula that doesn't parse (live preview error).
2. **Extract `referencedFields[]`** from the AST — the set of field names the formula reads. Stored for recalc ([§4](#4-dependency-tracking--recalc)).
3. **Validate** every function against the **allowlisted formulajs subset** and every field reference against the object's `AttributeDef`s. Anything unlisted → reject.
4. **Evaluate** by walking the AST: field refs resolve from the record's current values; function calls dispatch to formulajs; operators do safe arithmetic (divide-by-zero → an error value, never `NaN`/`Infinity`).

---

## 4. Dependency tracking & recalc

**formulajs is just functions — no dependency graph** (that's what HyperFormula gave up). We build lightweight tracking:

- **At save:** parse → record which fields the formula reads (`referencedFields[]`).
- **Two evaluation modes:**
  - **Stored (materialized) computed field** — its value is written to the record and **recomputed when any referenced field changes**, through the CRM write path (the same transaction that writes `FieldHistory`). Fast to read in tables/pivots; costs a recompute on write.
  - **Report-only expression** — evaluated **at query time**, never stored. No write cost; costs a per-row eval on read. Used for one-off report math.
- **Transitive dependencies:** a formula field may reference another formula field. Build the dependency edges from `referencedFields[]`; on a base-field change, recompute the affected formula and anything downstream, in topological order.
- **Circular-reference detection:** at save, walk the dependency graph; if adding this formula creates a cycle (A→B→A), **reject with a clear message**. No runtime infinite loops.
- **Batch recompute:** a bulk update (import, mass-edit) recomputes affected formula fields in a batched job, not row-by-row-synchronously, to avoid a write storm.

---

## 5. Types & semantics

- **Result type inference:** infer the formula's result type (number / text / boolean / date) from its outermost operation, so the pivot knows whether it's a measure (numeric) or dimension.
- **Row-level only.** A formula computes **per record** from that record's fields. It **cannot** reference an aggregate (`SUM` across rows) — aggregation is the pivot's job (measures), not the formula's. `SUM(A, B)` within a row (across arguments) is fine; "sum of Amount across all deals" is a measure, not a formula. This boundary is enforced and explained.
- **Null handling:** a null input follows spreadsheet semantics (formulajs conventions); the field defines its own "empty," consistent with the semantic-type rules in [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md).
- **Currency/units:** a formula over `amountMinor` stays in integer minor units; mixing currencies is blocked (same rule as the pivot).
- **Dates:** `Now()`/`DAYS()` etc. respect the timezone rules ([architecture §6](SPEC-REPORTING-ARCHITECTURE.md#6-timezone-correctness--the-1-the-numbers-are-wrong-bug)) — a date formula never uses the server zone.

---

## 6. Error handling & UX

Every error is caught and shown in the **live preview** at edit time, and again on the field if it errors at runtime — never a crash, never a silent wrong value:

- **Parse error** (bad syntax) → "Check your formula near '…'."
- **Unknown function / field** → "No field named 'Costt' — did you mean 'Cost'?"
- **Type mismatch** (`IF` on a number where text expected) → explained inline.
- **Divide by zero** → the field shows an error value (`—`), never `NaN`/`Infinity`.
- **Circular reference** → rejected at save with the cycle named.
- **Referenced field later deleted/renamed** → the formula field shows an **errored** state (not a crash); the preview flags it; the user fixes or removes it.
- **Evaluation timeout / oversized expression** → rejected (see §7 limits).

---

## 7. Security & resource limits

- **No arbitrary code.** Only the allowlisted formulajs function subset + jsep's operators are evaluable. No property access into host objects, no prototype walking, no I/O.
- **No `eval`, no `vm2`.** A test greps the evaluation path to assert neither exists ([testing §7](SPEC-REPORTING-TESTING.md#7-jobs--data-integrity)).
- **Function allowlist** — we ship a curated formulajs subset (math, logical, text, date, lookup within the record); anything not on the list is rejected. Grow the list deliberately.
- **Expression-size cap** and **AST-depth cap** — reject a pathologically large/nested formula.
- **No cross-record reach** — a formula reads only *this record's* fields (+ referenced formula fields on the same record); it cannot query other records or reach SQL.
- **Recalc is orgId-scoped** — a recompute only touches the same org's records.

---

## 8. Data model

The `ComputedField` from the master spec, extended:

```prisma
model ComputedField {
  id              String  @id @default(cuid())
  orgId           String
  objectSlug      String
  name            String
  formula         String            // spreadsheet syntax, parsed by jsep, evaluated by formulajs
  referencedFields String[]         // extracted from the AST at save — powers recalc + cycle detection
  resultType      String            // number | text | boolean | date (inferred; drives measure vs dimension)
  mode            String  @default("stored") // stored (materialized, recompute on input change) | report (query-time)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([orgId, objectSlug, name])
  @@index([orgId, objectSlug])
}
```

Stored-mode values live on the record (a column in `customJson` or a typed cell, per [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md)); a change writes `FieldHistory` like any field.

---

## 9. Edge cases

- **Formula referencing a formula** → transitive recompute in topo order (§4).
- **A base field's type changes** under a formula → re-validate the formula; error if now incompatible.
- **Import sets many inputs at once** → batched recompute, not per-row sync.
- **Report-only expression on a huge result set** → per-row eval bounded by the report's row cap / async export (architecture §9).
- **Two formulas that would form a cycle only after both exist** → detected at the second save; rejected.
- **Deleting a base field a formula depends on** → block or warn ("2 formula fields use 'Cost'"), like deleting a report used on dashboards.

---

## 10. Testing (see [SPEC-REPORTING-TESTING.md](SPEC-REPORTING-TESTING.md))

- Golden formulas with hand-computed results across math/logical/text/date functions.
- Parser rejects unknown functions/fields; allowlist enforced.
- Circular-reference detection rejects a cycle.
- Recalc fires when a referenced field changes; transitive recompute correct.
- No `eval` path exists (grep test); oversized/over-deep expressions rejected.
- Divide-by-zero → error value, not `NaN`.
- Renamed/deleted referenced field → graceful errored state.

---

## 11. Open decisions

1. **Stored vs report-only default.** Recommend **report-only for report math (v1)**, **stored for fields used in tables/filters** — let the user choose per field, defaulting to report-only (no write cost). *(Recommend as stated.)*
2. **Formulajs function allowlist scope.** Recommend starting with **math + logical + text + date + record-scoped lookup**, excluding anything financial/statistical until asked. *(Recommend the core subset.)*
3. **Recalc engine — hand-rolled tracking vs adopting a graph lib.** Recommend **hand-rolled** (`referencedFields[]` + topo sort) — HyperFormula's license is out and we don't need a cell model. *(Recommend hand-rolled.)*
