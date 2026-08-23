# Doc 14 — Backlog

Features parked for later. Each is **one or two sentences: what it does + the value**. No full journeys — we spec these when they come up the priority list. Grouped so it's scannable.

**Convention:** **[LATER]** = deliberately deferred. **[already specced → link]** = you listed it, but it's already written elsewhere; kept here only as a pointer so nothing looks dropped. **[NEW]** = added to the backlog this round.

**Phase note:** most of this needs multi-user (doc 11) or is candy. We re-sequence together.

---

## Integrations & data sync
- **Two-way sync with Salesforce / HubSpot / Attio** [NEW] — mirror records both ways so a team can adopt us without leaving their system of record. *Value: removes the biggest switching barrier for teams that "can't move off Salesforce yet."*
- **Migration wizard from Salesforce / HubSpot / Attio** [NEW] — a guided **one-time import** (connect the source, map objects/fields, preview, then bulk-load People/Companies/Deals/activity) — distinct from the ongoing two-way sync above (this is "move in once," that is "keep both live"). *Value: the on-ramp that turns "I have 5 years of data in Salesforce" from a blocker into a 20-minute setup. Builds on the existing import path (doc 3 company import, doc 5a) + field-mapping, plus source-specific schema mappers.*
- **App marketplace** [NEW] — a directory of third-party integrations users can install. *Value: coverage we don't have to build; ecosystem pull.*
- **Let others embed their UI in our app** [NEW] — an extension surface (iframe/app-panel) so partners render their own UI inside a record. *Value: deep integrations without us building each one.*
- **Connect to other telephony APIs** [NEW] — beyond Twilio (e.g. Telnyx, Vonage). *Value: cost/quality options and redundancy; the telephony layer is already abstracted (doc 1).*
- **Suggest accounts & contacts to import** [NEW] — scan the connected mailbox/calendar (and later synced address books) to surface a ranked list of people and companies the user already talks to but hasn't added, for one-click import as People/Companies (runs through the doc-5a dedupe + match pipeline). *Value: bootstrap the CRM from real relationships instead of a blank slate — the "who am I already emailing?" onboarding win.*
- **Sync address books** [NEW] — connect Google / Microsoft (and later phone) contacts and keep People in sync both ways. *Value: contacts stay current without manual entry; a low-effort, high-coverage source of People records.*
- **Extract names (and details) from email** [NEW] — parse sender display names and email signatures to fill or create People — name, title, phone, company — feeding the same dedupe + match pipeline (doc 5a). *Value: richer contacts with zero typing; extends today's From-name use and auto-create-from-attendee (doc 5) into full signature capture.*

## Outreach & sequences
- **Email / call / text sequencer** [already specced → [doc 15](15-sequences-and-campaigns.md)] — multi-step, multi-day cadences across email + call-task + SMS with reply/branch/auto-exit logic. Pulled off the backlog and specced at full depth. *Value: systematic follow-up at volume; the #1 loved feature in Salesloft reviews.*
- **Add LinkedIn as a sequence channel** [NEW] — a LinkedIn step type (connect / message / InMail) inside the [doc 15](15-sequences-and-campaigns.md) sequencer. *Value: outreach that isn't email/call/text-only; matches Salesloft/Outreach. Deliberately skipped in doc 15's first cut — the data model leaves room for it.*
- **Send LinkedIn InMail** [NEW] — send InMail from within a sequence/record (the send primitive behind the channel above). *Value: reach prospects who ignore email.*
- **AI list building from firmographic filters** [already specced → [7.7e](7-ai-copilot.md)] — describe an ICP, agent sources new records into a list. Kept as a pointer.

## Dialer & telephony
- **Parallel dialing** [NEW] — dial several numbers at once, connect the rep to whoever answers first. *Value: more dials/hour. Caveat from research: it raises dials, not connect **rate**, and adds a connect-delay "robocall" pause — spec it quality-first (see [competitor-reviews](../other/competitor-reviews-and-positioning.md)).*
- **Call-quality (MOS) scoring + bad-connection warning** [NEW] — measure call audio quality and warn the rep on a bad line. *Value: protects the conversation; "bad call quality" is the top dialer complaint everywhere.*
- **AI phone-tree navigation (IVR)** [NEW] — the AI presses the right menu options to reach a person. *Value: reps skip the "press 1 for sales" maze on every call.*
- **Dial-by-name directory handling** [NEW] — when an operator/IVR asks for an extension or name, the AI handles it. *Value: fewer dead-ends reaching the target.*
- **Live in-call structured extraction** [NEW] — run the transcript through extraction *during* the call, not only post-call, so structured insights (fields, buying signals, next-question hints) surface in real time. *Value: faster in-call cues for the rep. Today extraction runs post-call on the clean diarized transcript (doc 2a, job C3) for accuracy; this trades some accuracy for speed — see doc 2a's "during vs after" table.*
- **Default live continuous voice AI (Vapi-style)** [NEW] — a real-time, always-listening voice agent that streams speech-to-text → LLM → text-to-speech mid-call, so the AI can *talk on the call* (handle gatekeepers, navigate IVRs, even run a full conversation), not just transcribe and summarize after. *Value: the leap from "AI watches the call" to "AI works the call." Big scope: needs low-latency streaming (~sub-500ms round-trip), barge-in/interruption handling, and a voice provider — spec it against [Vapi](https://vapi.ai) / [Retell](https://retellai.com) as the benchmark. Sits on top of, not instead of, the manual dialer (doc 2/3) — a rep can hand a call to it or take it back.*

## Call intelligence at scale [LATER] (from [doc 6](6-call-intelligence.md))
- **Trackers / smart-trackers & saved searches across the whole call library** [NEW] — beyond the per-call tracked-vocabulary dictionary (doc 6 Journey 6.6), search and save queries across every call. *Value: library-wide insight, Gong's "Trackers."*
- **Sentiment shifts & topic segmentation** [NEW] — detect mood changes and auto-segment a call into topics. *Value: faster navigation and deal-risk signal.*
- **Call library + clips** [NEW] — save and share call snippets. *Value: coaching and knowledge-sharing.*
- **Rep scorecards** [NEW] — structured per-rep call scoring. *Value: manager coaching at scale.*
- **Shared call links with permissions** [NEW, needs multi-user] — share a call read-only outside the immediate team. *Value: cross-functional review.*
- **AI coaching — roleplay training mode** [NEW] — an AI voice bot plays the prospect and scores the rep. *Value: safe practice reps; from the Nooks benchmark notes.*
- **Filler-word detection** [NEW] — flag "um/uh/like" density, building on the talk-ratio/monologue metrics (doc 6 Journey 6.5). *Value: concrete delivery coaching.*
- **Post-call coaching — one-thing-well + one-tip** [NEW — moved from 7.12] — after each call, one thing the rep did well + one short suggestion (gatekeeper calls included), expandable on request, grounded in three knowledge bases (the app's playbook, the company's materials, the rep's own notes). Opt-in. *Value: real-time improvement without a manager watching. Parked because good coaching needs a trusted methodology + tuned prompts + evals or it produces generic/wrong advice that erodes trust; when built it rides call-intelligence (doc 6) + the eval'd skill library ([7f](7f-skills.md)) with a golden set of scored calls. Benchmark: Gong — coaching workflows — https://help.gong.io/docs/create-coaching-workflows.*

## Team calling & the floor [needs multi-user]
- **Shared audio room before a dial session** [NEW] — reps hang out on voice to pump up before dialing. *Value: remote-team energy/morale — Nooks' most-loved feature.*
- **Floor presence — who's on the floor, dialing, or in a live call** [NEW] — a live view of the team's calling state. *Value: managers coach in the moment; reps feel a team.*
- **Manager whisper (rep-only)** [already specced → [3.13](3-dialer-at-scale.md), the live-transfer family] — manager coaches the rep mid-call, prospect can't hear.
- **Manager barge (join for all sides)** [NEW, sibling of 3.13] — manager joins a live call audible to everyone. *Value: saves a deal in real time.*

## Auth, billing & admin
- **SSO with SAML or Google** [already specced → [11.8](11-multiuser-teams-and-permissions.md)] — enterprise login. Pointer.
- **Billing — subscriptions, credits & metering** [already specced → [doc 17](17-billing-credits-and-subscriptions.md)] — hybrid per-seat + prepaid credit buckets on Stripe Billing; full journeys now live in doc 17. Still **[LATER]** (builds after multi-user), but the cost plumbing that feeds it starts in [doc 12](../development-guidelines/12-devops-and-infrastructure.md)/[13](13-superadmin-console.md). Kept here as a pointer. *(Doc 15 = Sequences, doc 16 = Theming — billing took the next free number.)*

## CRM fields & data quality
- **Calculated / formula fields** [already specced → [5.9e](5b-reporting-and-dashboards.md)] — user-defined formula fields (Excel-style, via `@formulajs/formulajs` + `jsep`), reusable across reports and tables. Kept here as a pointer so it's not double-built.
- **Default computed fields out of the box (e.g. "last activity date")** [NEW] — ship a small set of ready-made computed fields — **last activity date, days-in-stage, days-since-last-contact** — seeded on the standard objects so a new workspace has useful derived data with zero setup. *Value: the "it just knows" feeling; these are the fields every team recreates by hand. Builds on the 5.9e formula-field engine + the doc-4 seeding rule (seed idempotently, never clobber edits). `lastContactedAt` already exists as a raw field; this is the computed sibling.*
- **Prebuilt field-validation preset library (Zip, postal codes, SSN, …)** [NEW] — a menu of **ready-made validators/masks** for common formats (US Zip / ZIP+4, country postal codes, SSN, EIN, VAT, credit-card shape) so an admin picks "Zip" instead of writing a regex. *Value: clean data with no regex skill required. The validation **engine** already exists (doc 4b.13.6 — per-field format + pattern + accept-but-flag); this is a curated preset pack on top of it.*

## UX polish
- **Dark mode & theming** [already specced → [doc 16](../development-guidelines/16-theming-and-dark-mode.md)] — a dark theme across the app, on a semantic-token layer that makes every surface flip theme for free. Pulled off the backlog and specced at full depth. *Value: table-stakes for a tool people live in all day.*

---

*When any of these graduates to "build next," it gets a full journey in the relevant doc, in the house format. Nothing here is lost — it's parked with its value stated so we can prioritize honestly.*
