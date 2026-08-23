# Doc 17 — Billing, Credits & Subscriptions

Same journey format. This is **how we get paid** and how a customer manages their money with us: pick a plan, add a card, buy credits, see invoices, watch usage. It sits on top of the **metering foundation already built in [doc 13](13-superadmin-console.md)** (`UsageEvent` ledger) and the **cost plumbing in [doc 12](../development-guidelines/12-devops-and-infrastructure.md)** — this doc turns "what did this cost us" into "what do we charge them."

**Phase:** **[LATER]** — billing ships after multi-user (doc 11), because seats only mean something once teams exist. But it is **specced fully now** so the metering we build early (doc 13) is shaped to bill against later. The [backlog](14-backlog.md) billing pointer graduates here.

**Benchmark posture:** the whole stack is **Stripe Billing**, and the pricing *shape* is modeled on **Anthropic's Claude plans** (subscription + prepaid usage credits + tiers that loosen over time) — the exact pattern you're leaning toward, refined below.

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the page that tells the coding agent how to build it.

---

## The pricing model — options, a challenge to your lean, and the pick

**Your lean:** (a) usage-based; (b) buy credit subscriptions **OR** extra usage credits at any tier (like Claude Code); (c) tiers get more generous over time (like Claude Code); (d) a Stripe-or-subsidiaries stack.

**Where I agree, and where I'd push back — because you asked me to challenge (a).**

**The options for the base model:**

| Model | Who charges this way | The problem for us |
|---|---|---|
| **Pure usage-based** (pay only for what you use — minutes, AI, enrichment) | Clay; the data-tool camp | **Buyers hate unpredictable bills.** ~78% of IT leaders hit surprise consumption/AI charges in the last year; ~61% cut projects over surprise SaaS spikes. Only ~15% of SaaS run mostly-usage. Your MRR also goes lumpy and hard to forecast. |
| **Pure per-seat** (flat $/rep/mo) | Salesloft, Outreach, HubSpot Sales Hub | Predictable, but leaves money on the table on heavy AI/telephony users **and** exposes us — a light-usage seat and a heavy-usage seat cost us very differently, but pay the same. |
| **Hybrid: per-seat base + metered/credit component** | Gong (seat + platform fee), Apollo (seat + credits) | The consensus answer — ~46% of SaaS run hybrid. More to build (metering), but we're building the metering anyway (doc 13). |

**My challenge to "usage-based" as the base: don't.** A dialer + CRM + call-intelligence tool is a **seat-based workflow product**, not a data tool. Every direct comparable that sells *workflow* (Salesloft, Outreach, HubSpot) charges **per-seat**; the ones that charge on pure usage/credits (Clay) sell *data*. Our SMB buyer (2–30 reps) is the **most** budget-fear-sensitive segment there is — an unbounded meter is exactly what stalls a small-team purchase. And a pure meter punishes your best behavior: a rep who dials all day and runs AI on every call — your ideal power user — gets the scariest bill.

**The pick — hybrid, and it still gives you everything in your lean:**

1. **A per-seat subscription is the base** (predictable, matches what the buyer expects, covers our fixed cost floor). Tiers: **Starter / Pro / Scale** (names TBD), each seat including a **monthly allowance** of the variable-cost stuff (dialer minutes, AI call-analysis/summary, enrichment credits).
2. **Prepaid credit buckets for the variable-cost items** (telephony minutes, AI, enrichment) with **visible balances, spend caps, and optional auto-top-up** — this is the Claude/Anthropic model, and it's where your (b) lives. A customer can **buy extra credits on top of any tier** at any time, and a heavy team can commit to a bigger credit subscription. So we keep the usage upside without the usage-bill terror, because the base is predictable and the meter is *prepaid and capped* rather than a surprise invoice.
3. **Tiers get more generous over time — kept (your c).** Two mechanics, both from Anthropic: allowances **auto-increase** as an account builds usage history/tenure, and we **raise published allowances outright** periodically (a launch-generosity lever). We never *shrink* an existing customer's allowance.
4. **Stack — Stripe Billing (your d), with one correction.** "Stripe or subsidiaries": **Metronome is now a Stripe company** (acquired Jan 2026) — but **Orb is an Adyen company, not Stripe's** (acquired 2026), so it's not a "Stripe subsidiary." At our scale we **don't need any of them** — **Stripe Billing alone** does seats + metering (Meters) + prepaid credits (Credit Grants) + tax + dunning. Reach for Metronome/Lago only if metering complexity outgrows Stripe (not for years). **Lago** (open-source, self-hostable) is the fallback that fits our OSS bias if we ever want to drop the Stripe Billing bill — noted, not chosen.

**Net:** *usage-flavored, but seat-anchored.* You get credits-on-any-tier and ever-more-generous tiers exactly as you wanted; you avoid the pure-usage trap that kills SMB deals. If you still want to offer a **pure-usage/credits-only plan** for a specific segment (e.g. a solo user who won't buy a seat), it can be **one plan option** inside this same machinery — not the whole model.

- **Benchmark (beat this):** pricing *shape* — Anthropic (subscription + usage credits + tiers that loosen) — https://claude.com/pricing ; usage tiers that auto-advance — https://docs.anthropic.com/en/api/rate-limits ; hybrid rationale — Stripe usage-based guide — https://stripe.com/resources/more/usage-based-pricing-for-saas-how-to-make-the-most-of-this-pricing-model
- **Build docs:** Stripe pricing models — https://docs.stripe.com/products-prices/pricing-models ; per-seat — https://docs.stripe.com/subscriptions/pricing-models/per-seat-pricing

---

## New surfaces this doc adds

- **In-app Billing area** (customer-facing) — **Settings → Billing**: current plan + seats, credit balances with a burn-down meter, payment methods, invoices, and usage-this-period. Most CRUD is delegated to Stripe's hosted surfaces (Checkout, Billing Portal) so we never touch raw card data.
- **A credit-buy dialog** — buy a credit pack, or turn on auto-top-up.
- **Superadmin → Plans & Pricing** (in the doc-13 console) — define plans, prices, meters, credit packs, and allowances; the operator side of billing.
- **Billing notifications** — approaching-limit, low-credit, payment-failed/dunning, invoice-ready.

---

## Journey 17.1 — Add / update / remove a payment method

*As an admin, I want to add and manage the card we bill, so that our subscription and credit purchases can actually charge.*

**Prohibited-action boundary (important, and it's a feature, not a limitation).** We **never** render our own card-number field or handle raw PAN/CVC — that's a PCI liability we don't want and a line the app won't cross. **Stripe collects the card**; we only ever hold a Stripe `PaymentMethod` id and the safe display bits (brand + last-4 + exp).

1. **Entry point.** **Settings → Billing → Payment methods**, a **"Add payment method"** button (top-right of the payment-methods card).
2. **Add.** Clicking it opens **Stripe** — either the **Billing Portal** (hosted, least code) or an embedded **Stripe Payment Element** in a modal (more control) — where the admin types the card. On success, Stripe returns a `PaymentMethod` id; we store the ref + display bits and show the card in a list ("Visa •••• 4242 · exp 09/28 · Default").
3. **Set default / remove.** Each saved card row has **Make default** and **Remove** (overflow ⋯). Remove is blocked with a clear reason if it's the only card on an active paid subscription ("Add another card first — this one is paying your subscription").
4. **What the user sees on failure.** A declined/expired card surfaces inline with Stripe's reason; we never store a failed card as usable.

- **Benchmark (beat this):** Stripe Billing Portal (hosted PM management) — https://docs.stripe.com/customer-management ; Stripe Payment Element (embedded) — https://docs.stripe.com/payments/payment-element
- **Build docs:** Stripe Elements — https://docs.stripe.com/payments/elements ; SetupIntent (save a card without charging) — https://docs.stripe.com/payments/save-and-reuse

## Journey 17.2 — Subscribe to a plan (Create)

*As an admin, I want to pick a plan and seat count and start paying, so that my team gets the paid features.*

1. **Entry point.** **Settings → Billing** shows the current plan (Free/trial by default). A **"Choose a plan"** / **"Upgrade"** button opens the **plan picker** — Starter / Pro / Scale as cards, each listing price/seat, included monthly allowances (dialer minutes, AI analyses, enrichment credits), and feature deltas. A **monthly/annual** toggle (annual discounted).
2. **Pick plan + seats.** He picks a plan and a **seat count** (defaults to current active users, doc 11). A live line-item preview shows `seats × price − annual discount + tax (Stripe Tax) = today's charge`.
3. **Checkout.** **"Start subscription"** opens **Stripe Checkout** (hosted) prefilled with the line items; card is collected there (or reuses the default PM from 17.1). On success, Stripe fires `checkout.session.completed` → our webhook (job P1) provisions the plan + seats and unlocks features.
4. **Confirmation.** Back in-app he sees **"You're on Pro — 8 seats"**, the first invoice, and the credit allowances now showing in the balance meters (17.4).

**Edge cases:** trialing (a plan can carry a free-trial window — no charge until it ends, a reminder before it does); proration is handled by Stripe on any mid-cycle change (17.3); a failed first charge leaves the plan **un-provisioned** (we provision on `invoice.paid`, not on intent).

- **Benchmark (beat this):** Stripe Checkout for subscriptions — https://docs.stripe.com/billing/subscriptions/build-subscriptions ; Attio billing/plan UX — https://attio.com/pricing
- **Build docs:** design a subscriptions integration — https://docs.stripe.com/billing/subscriptions/design-an-integration ; Stripe Tax for subscriptions — https://docs.stripe.com/billing/subscriptions/tax/automatic-tax

## Journey 17.3 — Change or cancel a subscription (Update / Delete)

*As an admin, I want to add seats, move tiers, or cancel, so that billing follows how my team actually uses the product.*

1. **Change seats.** **Settings → Billing → Manage → Seats**: a stepper. Adding seats charges a **prorated** amount immediately (Stripe proration); removing seats **schedules** the reduction for the next period (never a mid-cycle refund surprise) and is blocked below the count of active users unless he deactivates users first (doc 11). Seat changes reconcile with the user/invite model in doc 11.
2. **Upgrade / downgrade tier.** The plan picker (17.2) again; **upgrade** takes effect now (prorated), **downgrade** takes effect **next period** (keep what they paid for through the cycle). We warn if a downgrade drops a feature they're actively using or shrinks an allowance below current-period usage.
3. **Cancel.** **Manage → Cancel plan** → a confirm dialog stating **what they keep until period end** and **what happens to data** (read-only export window per doc 11.9 retention). Cancel sets the sub to **cancel-at-period-end** (not instant) unless they explicitly choose "cancel now." Stripe fires `customer.subscription.updated/deleted` → job P1 flips entitlements at the effective time.
4. **Reactivate.** A canceled-but-not-yet-lapsed sub shows **"Resume plan"** (one click, no re-checkout). A fully lapsed account re-subscribes via 17.2.

- **Benchmark (beat this):** Stripe Billing Portal (self-serve upgrade/cancel with proration) — https://docs.stripe.com/customer-management/integrate-customer-portal
- **Build docs:** subscription upgrades/downgrades + proration — https://docs.stripe.com/billing/subscriptions/prorations

## Journey 17.4 — Buy extra usage credits, and auto-top-up (your "credits at any tier")

*As an admin on any tier, I want to buy more dialer/AI/enrichment credits when we run low, so that a heavy week doesn't block the team.*

1. **Where credits live.** **Settings → Billing → Credits** shows a **burn-down meter per bucket** — e.g. *Dialer minutes: 1,240 / 5,000 left · AI analyses: 320 / 1,000 · Enrichment: 80 / 500* — with a projected run-out date from recent burn. This reads directly off our `UsageEvent` ledger (doc 13) against the current allowance + purchased credits.
2. **Buy a pack.** **"Buy credits"** opens a dialog with **fixed packs** (e.g. +2,500 minutes, +1,000 AI analyses), volume-discounted. Purchase → **Stripe Checkout** → on `checkout.session.completed`, job P1 issues a **Stripe Credit Grant** and our `CreditBalance` reflects it in real time. Credits **stack on top of any tier's allowance** and are consumed after the included allowance is used (allowance first, purchased credits second).
3. **Auto-top-up (opt-in).** A toggle: *"When a bucket drops below **X**, auto-buy pack **Y** (max **Z**/month)."* Guardrailed by a monthly ceiling so it can never run away — and every auto-charge notifies (17.7). This mirrors Stripe's advanced-usage auto-top-up.
4. **Caps, not surprises.** A workspace can also set a **hard spend cap** per bucket; at the cap we **degrade/pause** that feature (e.g. block new enrichment) with a clear banner rather than silently charging more — the same posture as the doc-13 budget kill-switch, but customer-facing.

**Why prepaid + capped, not postpaid metering (ties back to the challenge):** prepaid credits with a visible balance and a cap are what make a usage component *safe* for an SMB — they can never be shocked by an invoice, because they bought the credits up front and set the ceiling. This is the whole reason the hybrid model beats pure usage-based for our buyer.

- **Benchmark (beat this):** Anthropic usage credits + top-ups — https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans ; Stripe credits for usage-based billing — https://stripe.com/blog/introducing-credits-for-usage-based-billing
- **Build docs:** Stripe billing credits (grants + balance) — https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits ; Credit Balance Summary API — https://docs.stripe.com/api/billing/credit-balance-summary

## Journey 17.5 — View usage, invoices & billing history (Read)

*As an admin, I want to see exactly what we've used and been charged, so that I can trust the bill and manage cost.*

1. **Usage-this-period.** **Settings → Billing → Usage** — the same slices as the operator console (doc 13.2) but scoped to this workspace and framed as *consumption against allowance*: dialer minutes, AI analyses, enrichment, by day and by user. Every number is attributable (which rep, which feature) so a manager can see who's burning what.
2. **Invoices.** **Settings → Billing → Invoices** — a list (date · amount · status · PDF). Each row opens/downloads the **Stripe-generated invoice PDF** (tax-compliant line items). Failed/past-due invoices are flagged with a **Pay now** action.
3. **Receipts & tax.** Invoices carry the Stripe Tax breakdown; billing email + VAT/Tax ID fields (Settings → Billing → Details) feed Stripe so invoices are compliant for their jurisdiction.
4. **Export.** Usage export (CSV) for the finance team.

- **Benchmark (beat this):** Stripe hosted invoices + Billing Portal history — https://docs.stripe.com/invoicing/hosted-invoice-page ; operator cost view parity — doc 13 Journey 13.2
- **Build docs:** Stripe Invoicing — https://docs.stripe.com/invoicing ; reads the `UsageEvent` ledger (doc 13)

## Journey 17.6 — Superadmin sets up plans, prices, meters & credit packs (operator CRUD)

*As a superadmin, I want to define the plans, allowances, meters, and credit packs, so that the whole billing model is config, not code.*

This is the **operator side**, living in the **doc-13 console** (Superadmin → Plans & Pricing), next to model routing (13.3) and cost budgets (13.2) — because *what a feature costs us* (13) and *what we charge for it* (here) belong side by side.

1. **Define a Plan** — name, seat price (monthly/annual), included **allowances** per bucket (dialer minutes, AI analyses, enrichment credits), feature entitlements, and trial length. CRUD; a plan maps to a **Stripe Product + Prices**.
2. **Define Meters** — one per metered bucket (dialer-minutes, ai-analysis, enrichment), each a **Stripe Meter** whose events we emit (job P2) from the `UsageEvent` ledger. (This is the current Stripe Meters model — the deprecated `usage_records` API is not used.)
3. **Define Credit Packs** — fixed bundles (size + price + volume discount) that back the buy-credits dialog (17.4), each a Stripe price that maps a purchase to a **Credit Grant**.
4. **Allowance-generosity levers (your "tiers loosen over time").** Two controls: a **published-allowance bump** (raise a plan's included allowances for everyone, never lower for existing subs) and an **auto-increase rule** (tenure/usage-based allowance step-ups). Changes are audited (`AdminAudit`, doc 13) and versioned so we can see what a customer was promised when.
5. **The margin view.** Because cost-per-feature is metered (doc 13.2) and price is set here, the console shows **gross margin per plan/feature** — so a price is never set blind to what it costs us to serve.

- **Benchmark (beat this):** Stripe Dashboard product/price catalog (operator clarity) — https://docs.stripe.com/products-prices/how-products-and-prices-work ; Stripe Meters — https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api
- **Build docs:** Stripe Products & Prices — https://docs.stripe.com/api/prices ; Meter Events — https://docs.stripe.com/api/billing/meter-event ; ties to doc 13 `ModelRouting` + `UsageEvent`

## Journey 17.7 — Billing notifications

*As an admin, I want to be warned before money problems happen, so that a failed card or a burned budget never silently breaks the team.*

Notifications route through the app's existing notification system (doc 4e / job E3) with optional email:

1. **Approaching allowance / low credit** — at **80%** of an allowance or credit bucket, an in-app + email nudge ("Dialer minutes 80% used — buy more or set auto-top-up"), linking to 17.4. At **100%**, the degrade/cap banner (17.4 step 4).
2. **Payment failed / dunning** — on `invoice.payment_failed`, notify the admin with a **Pay now** / **Update card** link; **Stripe Smart Retries** attempt recovery on their schedule while we send dunning emails; after the retry window a clear **grace-then-suspend** path (with warnings), never a silent lockout. Suspension follows doc 11/13 (features gated, data retained per retention).
3. **Auto-top-up fired** — a receipt notification whenever auto-top-up buys a pack (so it's never a hidden charge).
4. **Trial ending / renewal** — a reminder before a trial converts or an annual plan renews.
5. **Invoice ready** — optional per-invoice email with the PDF.

- **Benchmark (beat this):** Stripe Smart Retries + dunning — https://stripe.com/blog/how-we-built-it-smart-retries ; automatic collection (dunning emails) — https://stripe.com/docs/invoicing/automatic-collection
- **Build docs:** Stripe webhooks (`invoice.payment_failed`, `invoice.paid`) — https://docs.stripe.com/billing/subscriptions/webhooks ; reuses notification job E3 (doc 4e)

---

## Background jobs

All run on the shared pg-boss runner (doc 12), behind the queue with idempotency (a Stripe event can deliver twice).

- **P1 — Stripe webhook → provision.** **Trigger:** the Stripe webhook receiver (verifies signature, returns 200 in <500ms, enqueues). **Steps:** on `checkout.session.completed` / `invoice.paid` → provision plan+seats or issue a Credit Grant; on `customer.subscription.updated/deleted` → flip entitlements at the effective time; on `invoice.payment_failed` → start dunning (17.7). **Idempotent per Stripe `event.id`** (store-and-check so a re-delivery can't double-provision or double-grant — the classic top-up race). **pg-boss:** queue `billing-webhook`, `retryLimit: 5` with backoff, `singletonKey = stripeCustomerId` to serialize one customer's events. *(This is the doc-12 "ingest fast, process async, idempotent" webhook pattern.)*
- **P2 — Meter usage to Stripe.** **Trigger:** pg-boss cron (e.g. every 15 min) plus a flush at period close. **Steps:** read new `UsageEvent` rows (doc 13) since the last cursor, aggregate per meter+customer, POST **Stripe Meter Events**; advance the cursor. **Idempotent** via a per-batch key so a retry never double-reports usage. **pg-boss:** queue `usage-meter`, `retryLimit: 5`, `singletonKey = workspaceId`. (Metering is the same ledger doc 13 already writes — we're forwarding it, not re-instrumenting.)
- **P3 — Allowance & auto-top-up sweep.** **Trigger:** pg-boss cron (hourly) + on each `UsageEvent` burst (debounced). **Steps:** recompute remaining allowance/credit per bucket; fire 80%/100% notifications (17.7); if auto-top-up is armed and below threshold and under the monthly ceiling, buy a pack (17.4). **pg-boss:** queue `credit-sweep`, `retryLimit: 3`, `singletonKey = workspaceId:bucket`.

---

## Decisions for you (billing)

**1. Base model. Decided (my pick, and my challenge to your lean): hybrid — per-seat subscription + prepaid, capped credit buckets for variable-cost items** — not pure usage-based. Rationale in "The pricing model" above: every workflow comparable is per-seat; pure usage scares the SMB buyer and makes our revenue lumpy; hybrid keeps your credits-on-any-tier and generosity-over-time intact while removing the bill-shock. *A pure-usage plan can still exist as one option inside this machinery if a segment wants it.*

**2. Stack. Decided: Stripe Billing alone** (Checkout + Billing Portal + Payment Element + Meters + Credit Grants + Tax + Smart Retries). Correction to "Stripe or subsidiaries": Metronome = Stripe (2026), **Orb = Adyen (2026), not Stripe.** We don't need any add-on engine at our scale; **Lago (OSS)** is the noted fallback if we ever drop the Stripe Billing bill.

**3. Card handling. Decided (a hard boundary): Stripe collects all card data; we store only a `PaymentMethod` ref + display bits.** We never render a PAN/CVC field — PCI scope we refuse to take on, and it's better UX anyway (Apple/Google Pay, 3DS handled by Stripe).

**4. When to build. Decided: [LATER], after multi-user (doc 11)** — but the metering it bills on (doc 13) is built early and shaped to this doc, so turning billing on later is wiring, not re-architecture.

---

## Data model (Prisma) — additions in this doc

Extends the cumulative schema. Reuses doc-13 `UsageEvent` (the meter source) and doc-11 users/workspaces. **We store Stripe *references*, not card data.**

```prisma
model BillingAccount {        // NEW — one per workspace (Journeys 17.1–17.5)
  id               String  @id @default(cuid())
  workspaceId      String  @unique
  stripeCustomerId String  @unique
  defaultPmRef     String?        // Stripe PaymentMethod id (display bits below; never raw card)
  pmBrand          String?        // "visa" (display only)
  pmLast4          String?
  pmExp            String?        // "09/28"
  taxId            String?        // customer VAT/Tax ID for compliant invoices
  billingEmail     String?
}

model Subscription {          // NEW — the active plan (Journeys 17.2/17.3)
  id                 String  @id @default(cuid())
  workspaceId        String
  stripeSubId        String  @unique
  planId             String        // -> Plan
  seats              Int
  interval           String        // month | year
  status             String        // trialing | active | past_due | canceled | paused
  cancelAtPeriodEnd  Boolean @default(false)
  currentPeriodEnd   DateTime
}

model Plan {                  // NEW — operator-defined tier (Journey 17.6)
  id             String  @id @default(cuid())
  name           String        // Starter | Pro | Scale (or a usage-only plan)
  stripeProductId String
  seatPriceMonthly Decimal
  seatPriceAnnual  Decimal
  allowancesJson Json          // { dialerMinutes, aiAnalyses, enrichmentCredits } included per seat
  entitlementsJson Json        // feature flags this plan unlocks
  trialDays      Int     @default(0)
  isActive       Boolean @default(true)
}

model CreditBucket {          // NEW — a metered bucket's balance (Journey 17.4)
  id             String  @id @default(cuid())
  workspaceId    String
  bucket         String        // dialer_minutes | ai_analysis | enrichment
  allowanceUnits Int           // from the plan, reset each period
  purchasedUnits Int  @default(0) // from Stripe Credit Grants (top-ups)
  usedUnits      Int  @default(0) // derived from UsageEvent (doc 13)
  hardCapUnits   Int?           // customer spend cap; degrade/pause at cap
  autoTopUpJson  Json?          // { thresholdUnits, packId, monthlyCeilingUsd }
  @@unique([workspaceId, bucket])
}

model CreditPack {            // NEW — buyable bundle (Journeys 17.4/17.6)
  id          String  @id @default(cuid())
  bucket      String
  units       Int
  priceUsd    Decimal
  stripePriceId String
  isActive    Boolean @default(true)
}

// Invoices are NOT mirrored as a table by default — read them from Stripe (source of truth)
// and cache display rows if the list gets slow. Usage history reads the doc-13 UsageEvent ledger.
```

---

## Technology choices (this doc)

- **Everything on Stripe Billing.** Subscriptions/seats (Prices), metering (**Meters + Meter Events**, not the removed `usage_records`), prepaid credits (**Credit Grants** + Credit Balance Summary), **Checkout** for acquisition, **Billing Portal** for self-serve PM/invoice/cancel, **Payment Element** only where we want embedded UX, **Stripe Tax** for compliant tax, **Smart Retries + dunning** for recovery.
- **Metering source is the doc-13 `UsageEvent` ledger — not a second instrumentation.** We forward it to Stripe Meters (job P2). Cost (doc 13) and price (here) share one ledger, so margin is always visible (17.6 step 5).
- **Idempotency is the whole game.** Every Stripe webhook is processed once per `event.id`; every meter flush and credit grant carries an idempotency key — because the failure mode is charging twice or granting twice.
- **No raw card data, ever.** Stripe holds the PAN; we hold a token + last-4. This is both the PCI-scope decision and the prohibited-action boundary.
- **Provider-swap escape hatch.** Billing sits behind a thin internal `Billing` interface (create-customer, subscribe, meter, grant-credit, portal-link) so a future move to Lago/Metronome is an adapter swap, not a rewrite — the same abstraction discipline as the telephony and mail layers.

---

## Technical decisions, trade-offs & edge cases

- **We provision on money received, not intent.** Entitlements flip on `invoice.paid` / `checkout.session.completed`, never on a client "success" — a failed charge must never unlock a paid plan.
- **The top-up race** (customer pays, webhook fails → paid with no credits) is handled by idempotent, retried webhook processing **plus** a reconciliation sweep that compares Stripe's balance to ours and repairs drift. Money bugs are the expensive kind, so this gets belt-and-suspenders.
- **Seats reconcile with users (doc 11).** You can't have more active users than seats; removing seats is gated on deactivating users; adding a user beyond seats prompts a seat purchase. One source of truth for "who's active," shared with doc 11.
- **Downgrades/cancels never claw back the paid period.** Effective at period end unless the customer explicitly chooses "now"; we keep what they paid for.
- **Caps degrade, they don't surprise-charge.** A hit hard-cap pauses/degrades the feature with a banner; only opt-in auto-top-up ever spends beyond the plan, and it has its own monthly ceiling. This is the customer-facing twin of the doc-13 runaway kill-switch.
- **Tax/filing is calculate-not-file.** Stripe Tax computes and reports; registration and remittance are an operator responsibility per state nexus — a finance task, flagged here so it isn't assumed automatic. *(Consult counsel on nexus + the DPA; this doc is planning input, not legal advice.)*
- **Free/trial and lapsed states** are first-class: a workspace is always in exactly one billing state (free / trialing / active / past_due / canceled), and feature entitlements are a pure function of that state + plan — so there's never ambiguity about what a given workspace can do.
