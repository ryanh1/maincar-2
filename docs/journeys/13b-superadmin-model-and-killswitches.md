# Doc 13b — Superadmin: model routing, provider keys & kill-switches

The **control plane** of the superadmin console ([doc 13](13-superadmin-console.md)): the levers you pull to change how the product spends and behaves **without a code deploy** — which AI model each feature uses, which provider keys are live, and the emergency switches that turn a provider or feature off in seconds.

**Why it matters:** we depend on third-party providers that **spike in cost** (the cost decisions in [doc 13a](13a-superadmin-cost-monitoring.md) are enacted *here*) or **get pulled from under us** (the Proxycurl-enjoined lesson, [doc 7.7](7-ai-copilot.md)). So model choice and provider on/off must be **config read at runtime**, not code — a console change, not a release.

**Where things live (read/write split, [doc 13](13-superadmin-console.md)):** everything in this doc is **write** — forms and switches over our own `ModelRouting` / `FeatureFlag` models in the `/admin` area. There is no observability tool for "which model does call-summary use" — that's our config.

**Journey numbering:** `Journey 13b.1`, `13b.2`, …

---

## Journey 13b.1 — View the per-feature model routing (read)

*As a superadmin, I want to see, in one table, which model and provider every AI feature currently uses, so that I know exactly what's running before I change anything.*

1. In the `/admin` area → **AI → Model routing**.
2. You see a table: one row per **feature** (`call-summary`, `enrichment-waterfall`, `data-chat`, `sequence-email-draft`, `ai-field:*`, …), with its current **provider**, **model**, and the **30-day spend** for that feature (joined from the [doc 13a](13a-superadmin-cost-monitoring.md) ledger, so cost sits next to the lever that controls it).
3. This is the map behind the cost decisions in [doc 13a](13a-superadmin-cost-monitoring.md): "enrichment is 60% of spend" → you see enrichment's model here and can right-size it (Journey 13b.2).

```
AI → Model routing                                              [ + Add feature route ]
┌────────────────────────┬────────────┬────────────────────┬───────────┬──────────┐
│ Feature                │ Provider   │ Model              │ 30d spend │          │
├────────────────────────┼────────────┼────────────────────┼───────────┼──────────┤
│ call-summary           │ anthropic  │ claude-sonnet-5    │  $1,880   │ [ edit ] │
│ enrichment-waterfall   │ openai     │ gpt-4o             │  $5,910 ⚠ │ [ edit ] │
│ data-chat              │ anthropic  │ claude-sonnet-5    │   $470    │ [ edit ] │
│ sequence-email-draft   │ anthropic  │ claude-sonnet-5    │   $400    │ [ edit ] │
│ intent-classification  │ anthropic  │ claude-haiku-4-5   │    $60    │ [ edit ] │
│ (default / fallback)   │ anthropic  │ claude-sonnet-5    │     —     │ [ edit ] │
└────────────────────────┴────────────┴────────────────────┴───────────┴──────────┘
```

- **How the data arrives:** the routing rows come from the `ModelRouting` table; the spend column is a `UsageEvent` sum by `feature` ([doc 13a](13a-superadmin-cost-monitoring.md)).
- **Standing constraint:** the model is chosen **here, by you, on the backend** — there is **no per-user model picker** in the customer app. This keeps cost controllable and quality consistent.
- **Benchmark (beat this):** OpenRouter / LiteLLM model-routing config — https://openrouter.ai/docs , https://docs.litellm.ai/docs/routing ; the standing "super-admin-set model" constraint.
- **Build docs:** internal — read `ModelRouting`; the provider-agnostic call layer is the **Vercel AI SDK** ([doc 7](7-ai-copilot.md)).

## Journey 13b.2 — Set or change a feature's model (update / create)

*As a superadmin, I want to point a feature at a different model or provider from a dropdown, so that I can right-size cost or quality instantly without a deploy.*

1. On Model routing (Journey 13b.1) → **edit** a row (or **+ Add feature route** for a feature that's currently on the default).
2. A form: pick **provider** (anthropic / openai / …) and **model** (the dropdown lists the models we support for that provider), with a one-line hint of relative **cost/speed** (e.g. `claude-haiku-4-5 — cheapest, fastest, good for classification`).
3. Save → writes/updates the `ModelRouting` row → **live on the next call** (the Vercel-AI-SDK layer reads routing at call time, so swapping a model is a config change, not code).
4. The change is safe because the call site is **provider-agnostic**: the same feature code asks the routing table "who handles `call-summary`?" and gets a model handle back.

- **The cost lever in practice:** cheap/small models for cheap tasks (classification, short extraction → `claude-haiku-4-5`), strong long-context models only where they earn it (summaries, reasoning → `claude-sonnet-5`). You verify the saving against the [doc 13a](13a-superadmin-cost-monitoring.md) dashboard (spend-per-feature before/after).
- **If X then Y:** *If a budget's hard-stop is "degrade"* ([doc 13a](13a-superadmin-cost-monitoring.md) Journey 13a.4) → at 100% the meter temporarily routes that feature to its **cheaper fallback model** automatically; you see the effective model here reflect that until spend resets.
- **Benchmark (beat this):** OpenRouter model picker (swap model, keep the call) ; LiteLLM router config.
- **Build docs:** internal — `ModelRouting` upsert; consumed by the Vercel AI SDK provider layer ([doc 7](7-ai-copilot.md)).

## Journey 13b.3 — Add or rotate a provider key (create / update, encrypted)

*As a superadmin, I want to add and rotate provider API keys safely, so that credentials are current and never exposed.*

1. `/admin` → **AI → Provider keys**.
2. You see each provider (LLMs, Deepgram, Twilio, enrichment vendors) with **key status** (set / missing / last-rotated) — **never the key value** (keys are write-once, shown once at creation, then masked forever).
3. **Add / rotate:** paste a new key → **TOTP step-up** ([doc 13](13-superadmin-console.md) Journey 13.1) → the key is **encrypted at rest** (envelope encryption, app-level) and the old one is retained just long enough to swap without downtime, then destroyed.
4. **Managed keys are the default** (our keys, our accounts). **BYOK per workspace** — a customer's own key surfaced from their settings ([doc 7.7](7-ai-copilot.md)) — is honored when present, overriding the managed key for that workspace's calls.
5. Every add/rotate writes an `AdminAudit` row ([doc 13](13-superadmin-console.md) Journey 13.9) — value never logged, only "rotated openai key."

- **Prohibited-by-design:** the console **never displays a stored key** and never puts one in a URL/log. Rotation requires step-up because a leaked key is a direct cost/abuse vector.
- **Benchmark (beat this):** Stripe API-keys UI (write-once, masked, rotate with overlap) — https://stripe.com/docs/keys ; Doppler/Infisical secret rotation.
- **Build docs:** internal — encrypted key store (envelope encryption via KMS or app key); BYOK read from workspace settings ([doc 7.7](7-ai-copilot.md)).

## Journey 13b.4 — Flip a kill-switch: disable a provider instantly (update)

*As a superadmin, I want to turn a provider off in one click, so that when it's enjoined, breached, or spiking, I can stop using it in seconds — and the app routes around it with no deploy.*

1. `/admin` → **Kill-switches** (or the Overview Alerts band deep-links here when a provider alert fires).
2. You see a switch per provider. **Toggle a provider off** → **TOTP step-up** + reason → writes a `FeatureFlag` (`provider:<name>.enabled = false`) → **read at runtime by every call site**.
3. Effect is immediate: the **enrichment waterfall routes around** the disabled provider to the next one ([doc 7.7](7-ai-copilot.md)); a disabled LLM provider falls back to the routing table's alternate. No release, no restart.
4. This is the **Proxycurl scenario** ([doc 7.7](7-ai-copilot.md)) made operational: a provider gets enjoined at 9am, you flip it off at 9:01, the product keeps working on the remaining providers.

- **If X then Y:** *If the disabled provider is the only one for a feature with no fallback* → the feature degrades to "unavailable" with a clear in-app message, rather than erroring; you're warned of that at toggle time.
- **Benchmark (beat this):** PostHog feature flags (runtime, no deploy) — https://posthog.com/feature-flags ; LaunchDarkly kill-switch pattern.
- **Build docs:** internal — `FeatureFlag` read at runtime by provider adapters; the waterfall's route-around is [doc 7.7](7-ai-copilot.md).

## Journey 13b.5 — Create or edit a feature flag with rollout targeting (create / update)

*As a superadmin, I want to roll a feature to some workspaces or a percentage, so that I can ship carefully and kill a misbehaving feature fast.*

1. `/admin` → **Feature flags → + New flag** (or edit one).
2. A form: **key** (`enrichment.deep`, `sequences.sms`, …), **enabled** on/off, and **targeting** — all workspaces, a **list of workspaces**, or a **% rollout**.
3. Save → writes/updates the `FeatureFlag` row (`rolloutJson` holds the targeting) → read at runtime; a flag flip takes effect immediately.
4. **Kill a bad feature fast:** set `enabled = false` → the feature disappears for everyone next request, no deploy.

- **How targeting is read:** each gated feature calls `flag("key", { workspaceId })` at runtime; the resolver checks `enabled` + `rolloutJson`. Off-the-shelf PostHog can back this if we don't want to hand-roll the resolver.
- **Benchmark (beat this):** PostHog feature flags (targeting + % rollout) — https://posthog.com/docs/feature-flags ; LaunchDarkly.
- **Build docs:** internal — `FeatureFlag` + a runtime resolver, or PostHog flags.

## Journey 13b.6 — Global circuit-breaker: pause AI or enrichment (update)

*As a superadmin, I want one master switch to pause all AI or all enrichment, so that when spend spikes abnormally I can buy time to investigate without taking the whole app down.*

1. `/admin` → **Kill-switches → Global**.
2. Two master switches: **Pause all AI** and **Pause all enrichment**. Flip one → **TOTP step-up** + reason → writes a global `FeatureFlag` (`ai.paused` / `enrichment.paused`).
3. Effect: every AI/enrichment call site checks the global flag first and, if paused, **skips the call and returns a graceful "temporarily paused" state** (queued for later, not errored). The rest of the app — calling, CRM, comms — keeps working.
4. This is the **last-resort safety net** referenced across [doc 7 / 7.7](7-ai-copilot.md): if the [doc 13a](13a-superadmin-cost-monitoring.md) runaway alert fires and you can't yet tell why, you pause, investigate, and un-pause.

- **Why a graceful pause, not an error:** a paused AI feature should read as "we'll do this in a moment," not as a crash. Work that can wait (summaries, enrichment) is re-enqueued; work that can't degrades visibly.
- **Benchmark (beat this):** Stripe's global API circuit-breakers ; the "big red button" pattern in LaunchDarkly.
- **Build docs:** internal — global `FeatureFlag` checked at the top of every AI/enrichment path; paused work re-enqueued via pg-boss ([doc 12](../development-guidelines/12-devops-and-infrastructure.md)).

---

## Decisions for you (control plane)

**1. Flag/kill-switch backend — hand-rolled `FeatureFlag` vs PostHog flags. Decided (my pick): hand-rolled `FeatureFlag` for provider/global kill-switches (they must work even if PostHog is down), PostHog flags for product rollouts.** The emergency switches can't depend on a third party being up; gradual feature rollouts can. *Alternative: PostHog for everything — rejected; a kill-switch that needs an external service is a single point of failure at the worst moment.*

**2. Provider-key storage — KMS envelope encryption vs a secrets manager (Doppler/Infisical). Decided (my pick): app-level envelope encryption with a KMS-held master key, keys write-once/masked.** No extra vendor, keys never leave our DB in plaintext. *Alternative: a hosted secrets manager — reconsider if key count/rotation grows beyond a handful of providers.*

**3. BYOK precedence — managed default vs customer key. Decided (standing): customer BYOK overrides the managed key for that workspace's calls when present; managed is the default everywhere else.** Lets a customer bring their own quota/cost while we stay the default. Confirmed here as the routing rule.

## Data model (Prisma) — additions in this doc

```prisma
model ModelRouting {         // NEW — per-feature model/provider choice (Journeys 13b.1–2)
  id        String  @id @default(cuid())
  feature   String  @unique   // "call-summary" | "enrichment-waterfall" | "default" | ...
  provider  String            // anthropic | openai | ...
  model     String            // claude-sonnet-5 | claude-haiku-4-5 | gpt-4o | ...
  fallbackModel String?       // used when a budget hard-stop = "degrade" (doc 13a)
  updatedAt DateTime @updatedAt
  // set by super-admin only; no per-user override
}

model ProviderKey {          // NEW — encrypted provider credential (Journey 13b.3)
  id          String   @id @default(cuid())
  provider    String   @unique          // openai | anthropic | deepgram | twilio | <vendor>
  ciphertext  String                    // envelope-encrypted; never returned to the client
  lastRotated DateTime @default(now())
  // BYOK per-workspace keys live on workspace settings (doc 7.7), not here.
}

model FeatureFlag {          // NEW — flags, provider kill-switches, global pauses (Journeys 13b.4–6)
  id          String  @id @default(cuid())
  key         String  @unique           // "provider:proxycurl.enabled" | "ai.paused" | "sequences.sms" | ...
  enabled     Boolean @default(true)
  rolloutJson Json?                      // targeting: workspaces list or % rollout
  updatedAt   DateTime @updatedAt
}
```

## Technical decisions, trade-offs & edge cases

**Model and provider are config, not code.** Every AI call site is provider-agnostic (Vercel AI SDK, [doc 7](7-ai-copilot.md)) and asks the `ModelRouting` table who handles a feature; every provider call checks a `FeatureFlag` first. So swapping a model, disabling a provider, or pausing all AI is a **console write read at runtime** — never a deploy. This is the whole reason the control plane exists.

**Kill-switches are a safety requirement, not a nicety.** Because we depend on providers that can be enjoined ([doc 7.7](7-ai-copilot.md)'s Proxycurl lesson) or spike in cost ([doc 13a](13a-superadmin-cost-monitoring.md)), a **runtime provider-disable** and a **global AI/enrichment pause** must exist so we can react in seconds. The emergency switches are hand-rolled so they don't depend on any third party being up.

**Keys are write-once and never shown.** The console can set/rotate a provider key but can never display a stored one; rotation is step-up-gated and audited (value never logged). A leaked provider key is a direct cost-and-abuse vector, so it gets the same treatment as a destructive action.

**Degrade beats block.** A budget hard-stop ([doc 13a](13a-superadmin-cost-monitoring.md)) and a missing provider both prefer **falling back to a cheaper/alternate model** over erroring — the `fallbackModel` on `ModelRouting` and the waterfall route-around ([doc 7.7](7-ai-copilot.md)) keep features working (at lower cost/quality) instead of breaking.
