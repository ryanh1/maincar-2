# Doc 11a — Slack Integration

Post the team's high-signal deal events into Slack — **won deals, key stage changes, new high-value deals, at-risk/stale deals** — so the team celebrates and reacts where they already live. Split out of [doc 11](11-multiuser-teams-and-permissions.md) because it is really **several distinct journeys** that were crammed into one.

**Phase note:** **[NEAR-TERM]** — build when the second seat lands (a Slack post is genuinely useful even to a 2-person team). Nothing here is single-user (a solo rep has no channel to post to), but it's cheap because it **reuses the workflow engine** ([doc 10.4](10-workflows-and-automation.md)) — a Slack post is just a workflow action.

**Journey numbering:** doc 11a, so journeys are `Journey 11a.1`, `11a.2`, …

**Covers:** building our Slack app (one-time, us); a customer connecting Slack (install/OAuth); the one Slack-side step (inviting the bot to a channel); configuring event→channel maps in our app; the runtime post; what each notification looks like (Block Kit); managing/disconnecting.

---

## How Slack apps actually work (the mental model — read this first)

This answers your core questions: **do we create a Slack app? which app / which screen / do reps go back and forth?**

- **Yes — we create *one* Slack app**, once, called "MainCar," in Slack's developer dashboard (api.slack.com). This is **our** app, built by us. Customers do **not** create a Slack app; they **install ours**.
- A Slack app is **installed per Slack workspace** by a customer admin, via an **"Add to Slack" OAuth flow**. Installing grants our app a **bot token** for *their* Slack, which is what lets us post messages.
- **Where does each thing happen? Almost everything is in *our* app.** The only two things that happen *in Slack* are: (1) the one-time **"Allow"** click on the OAuth consent screen during connect, and (2) **inviting the bot to a private channel** (Slack requires this for private channels). Everything else — choosing which events post to which channel, thresholds, turning it off — is configured **in our app, in Settings → Integrations → Slack.**
- **Do reps go back and forth between apps? No.** After the one-time admin connect, reps never touch Slack's settings. They configure in our app; the messages simply *appear* in Slack. The back-and-forth is a one-time admin setup, not a daily-use pattern.

- **Benchmark (beat this):** Attio — Slack app (install + "won deal" template) — https://attio.com/help/apps/automations-apps/slack-app ; HubSpot + Slack — https://www.hubspot.com/slack ; Slack — how apps are installed & OAuth — https://api.slack.com/authentication/oauth-v2

---

## Journey 11a.1 — Build the MainCar Slack app (us, one-time) [NEAR-TERM]

*As a super-admin at our company, I want to create and configure our Slack app once, so that every customer can install the same app into their Slack.*

This is a **build-time / operator task**, not a customer journey. Done once, by us.

1. In **api.slack.com → Create New App** (from an app manifest, so it's version-controlled), we define the **MainCar** app: name, icon, and the **bot scopes** it needs — at minimum `chat:write` (post messages), `channels:read` + `groups:read` (list channels to map), and `chat:write.public` (post to public channels without an explicit invite). Interactive buttons (11a.6) add `commands`/interactivity + a request URL.
2. We set the **OAuth redirect URL** (back to our app's `…/integrations/slack/callback`) and enable **"distribution"** so any Slack workspace — not just ours — can install it (public distribution, or Slack Marketplace listing later).
3. We store the app's **client ID / client secret** in the superadmin console ([doc 13.3](13-superadmin-console.md) provider keys), never in the repo.
4. Interactivity + event subscriptions point at our endpoints so **button clicks** (11a.6) come back to us.

- **Benchmark (beat this):** Slack — app manifests — https://api.slack.com/reference/manifests ; Slack — distributing apps / OAuth — https://api.slack.com/authentication/oauth-v2
- **Build docs:** internal — app manifest checked into the repo; secrets in doc-13 key store.

## Journey 11a.2 — Connect Slack to your workspace (customer admin, once) [NEAR-TERM]

*As an admin, I want to connect our Slack in a couple of clicks, so that MainCar can post to our channels.*

1. **Entry point (in our app).** **Settings → Integrations → Slack**. Before connecting, the card shows a short "what you'll get" (the four event types) and one primary button, **Add to Slack**.
2. Clicking **Add to Slack** sends the admin to **Slack's OAuth consent screen** (this is the one moment they're in Slack). It lists the permissions and a **workspace picker** (if they're in several Slacks). They click **Allow**.
3. Slack redirects **back into our app** (the callback URL from 11a.1). We exchange the code for a **bot token**, store it encrypted (envelope encryption, like the doc-5 OAuth connections), and record the connected Slack workspace name.
4. The admin lands back on **Settings → Integrations → Slack**, now showing **Connected to [Slack workspace name]** and the **event-mapping UI** (Journey 11a.4). One round-trip; done.

**Permission (who can do this).** Connecting is an **admin** action (it grants a workspace-wide integration). A rep can't connect Slack. *(This is an "accept terms / grant OAuth" action — in the app it's an explicit admin click; the agent building it must not auto-approve OAuth on anyone's behalf.)*

- **Benchmark (beat this):** Attio — connect Slack — https://attio.com/help/apps/automations-apps/slack-app ; Slack — OAuth v2 flow — https://api.slack.com/authentication/oauth-v2
- **Build docs:** internal — OAuth code→token exchange; `SlackConnection` row (below), token encrypted at rest.

## Journey 11a.3 — Make a channel available to the bot (the one Slack-side step) [NEAR-TERM]

*As an admin, I want the bot to be able to post to the channels I choose, so that my maps in 11a.4 actually deliver.*

1. For a **public channel**, `chat:write.public` (from 11a.1) means the bot can post **without any Slack-side step** — the channel just shows up in the mapping picker (11a.4).
2. For a **private channel**, Slack requires the bot to be **invited into it** — this is done **in Slack**, once, by typing `/invite @MainCar` in that channel (or Channel → Integrations → Add app). Our mapping UI (11a.4) detects when a chosen private channel lacks the bot and shows an inline hint: *"MainCar isn't in #deals-private yet — type `/invite @MainCar` there, then refresh."*
3. This is the **only** routine reason to touch Slack after connecting, and only for private channels.

- **Benchmark (beat this):** Slack — add apps to channels — https://slack.com/help/articles/202035138-Add-apps-to-your-Slack-workspace
- **Build docs:** internal — on map-save, call `conversations.info`; if `is_member=false` and private, surface the invite hint.

## Journey 11a.4 — Map events → channels (in our app) [NEAR-TERM]

*As an admin or manager, I want to choose which deal events post to which channel, so that the right people see the right signal without noise.*

All in **our app**, on the Settings → Integrations → Slack page, right below the connection status.

1. **The four mappable events** (start small — not "everything"), each a row the admin can add, configure, and toggle:
   1. **Deal won** → a celebrate channel (the #1 template everywhere).
   2. **Stage change** → a deal reaches a chosen key stage (Proposal Sent, Closed) — the admin picks *which* stage(s).
   3. **New high-value deal** → created/updated **above an amount threshold** (admin sets the number) → alert managers.
   4. **Deal at risk / stale** → no activity for **N days** (admin sets N) or close date approaching → nudge the owner.
2. **Each row:** an **event** (the four above), a **channel** (a searchable picker populated from `conversations.list` — public channels the bot can post to, plus private channels it's been invited to per 11a.3), optional **conditions** (amount/stage/owner — reusing the doc-4 filter grammar), and an **on/off toggle**. A **Send test message** button posts a sample to the channel so the admin sees it work immediately.
3. **Under the hood, each mapping is a workflow** ([doc 10.4](10-workflows-and-automation.md) "post to Slack" action) with the event as its trigger — so Slack maps are just productized workflows and inherit run history, retries, and the dry-run test. The admin never sees the workflow canvas here; this is the simple, purpose-built UI on top.

- **Benchmark (beat this):** Attio — Slack automation templates — https://attio.com/help/apps/automations-apps/slack-app ; HubSpot — Slack deal notifications — https://www.hubspot.com/slack
- **Build docs:** internal — each row persists to `SlackConnection.eventMapJson` **and** compiles to a doc-10 workflow; channel picker from `conversations.list`.

## Journey 11a.5 — A deal event fires and the message posts (runtime) [NEAR-TERM]

*As a rep or manager, I want the post to appear in Slack the moment the deal event happens, so that we react while it's hot.*

1. A deal event occurs (won / stage change / high-value / at-risk) — sourced from the **deal engine** ([doc 9](9-deal-board-and-forecasting.md)) and the change-event stream that already drives workflows ([doc 10.2](10-workflows-and-automation.md)).
2. The matching Slack workflow (from 11a.4) fires its **"post to Slack" action** — background job **S1** (below). It renders the message (11a.6) and calls Slack `chat.postMessage` with the mapped channel + bot token.
3. The message appears in the channel within a couple of seconds. If Slack returns an error (channel archived, bot removed, rate-limited), the run drops to the workflow **"needs attention"** state (doc 10.8) and the admin is notified — never silently dropped.

- **Benchmark (beat this):** Slack — `chat.postMessage` — https://api.slack.com/methods/chat.postMessage
- **Build docs:** internal — job **S1** on pg-boss; reuses the doc-10 workflow-run executor (W2).

## Journey 11a.6 — What the notifications look like (Block Kit) [NEAR-TERM]

*As a reader in the channel, I want a clear, scannable card — not a wall of text — so that I get the signal at a glance and can act.*

Built with **Slack Block Kit** (rich blocks, not plain text), one layout per event. Rough shapes:

- **Deal won** 🎉 — header "Deal won: **Acme Corp — $48,000**", a context line (owner avatar + name, close date), and buttons **View deal** (deep-links back into MainCar) + **Say congrats**.
- **Stage change** — "**Acme Corp** moved **Proposal Sent → Negotiation**", amount + owner, **View deal** button.
- **New high-value deal** 💰 — "New deal above $25k: **Beta Inc — $60,000**", owner + source, **View deal**.
- **Deal at risk** ⚠️ — "**Gamma LLC** is stalling — no activity in **14 days**, closes in 5", owner, and **interactive buttons** that kick off a follow-up (**Log a call**, **Snooze 3 days**) — these are **doc-10.4 workflow actions** triggered by the button click (11a.1 interactivity), so a click in Slack does real work in MainCar.

Every card **deep-links** to the deal in MainCar so a click goes straight to the record. Exact visual polish is left to the build to beat the benchmark below.

- **Benchmark (beat this):** Slack — Block Kit + Block Kit Builder (see/design layouts) — https://api.slack.com/block-kit ; https://app.slack.com/block-kit-builder ; Attio's won-deal card for the bar to beat — https://attio.com/help/apps/automations-apps/slack-app
- **Build docs:** internal — a Block Kit template per event; interactive buttons post back to our interactivity endpoint → trigger a doc-10 workflow.

## Journey 11a.7 — Manage or disconnect the connection [NEAR-TERM]

*As an admin, I want to see the connection's health and disconnect if needed, so that I stay in control of what posts to our Slack.*

1. **Settings → Integrations → Slack** shows: connected workspace, when connected, and each mapping's **last post + status** (healthy / needs attention, from the underlying workflow runs).
2. **Disconnect** revokes the token (`auth.revoke`) and disables all Slack mappings (their workflows pause, not delete — so reconnecting restores them). Confirmation states the consequence: "Slack posts will stop; your event maps are kept and resume if you reconnect."
3. If Slack **revokes us** on their side (app removed in Slack), we detect the failed post, mark the connection **disconnected**, and notify the admin to reconnect — the token is never assumed valid forever.

- **Benchmark (beat this):** Slack — `auth.revoke` / token lifecycle — https://api.slack.com/authentication/best-practices
- **Build docs:** internal — `auth.revoke`; on post-failure with `invalid_auth`/`account_inactive`, flip `SlackConnection.status` and alert.

---

## Background jobs

- **S1 — Slack event poster.** **Trigger:** a subscribed deal event (won / stage change / high-value / at-risk) fires the mapped Slack workflow (doc 10). **Steps:** render the Block Kit card (11a.6) → `chat.postMessage` with the channel + bot token → log result. **pg-boss:** runs on the doc-10 workflow executor (W2) — `retryLimit: 3` with backoff; **idempotent per (dealId, event, day)** so a retry never double-posts; a hard failure drops to the workflow "needs attention" state (doc 10.8). [NEAR-TERM]
- **S2 — Interactivity handler.** **Trigger:** a button click on a card (11a.6) hits our interactivity endpoint. **Steps:** verify the Slack signature → map the action to a doc-10 workflow (Log a call / Snooze / Say congrats) → run it → update the Slack message (`chat.update`) to reflect the action. Immediate. [NEAR-TERM]

---

## Decisions for you (Slack)

**1. One shared app, publicly distributed. Decided (my pick).** Build **one MainCar Slack app** and let each customer install it (OAuth). *Alternative: per-customer app manifests — rejected; enormous overhead, no benefit; the standard SaaS pattern is one distributed app.*

**2. Configure in our app, not in Slack. Decided (my pick).** All event→channel mapping and thresholds live **in our app**; Slack is used only for the one-time OAuth Allow and (for private channels) inviting the bot. *Alternative: a Slack slash-command config UI — rejected; splitting config across two apps is exactly the back-and-forth you flagged. A `/maincar` slash command can be a later convenience, not the config home.*

**3. Slack = a productized workflow, not a new engine. Decided (my pick).** Each mapping compiles to a doc-10 workflow with a "post to Slack" action, so it inherits triggers, run history, retries, and dry-run. *Alternative: a bespoke Slack notification subsystem — rejected; needless duplication of the workflow engine.*

**4. Interactive buttons in v1? My pick: yes for at-risk, minimal elsewhere.** The at-risk card's **Log a call / Snooze** buttons are where interactivity earns its keep. Won/stage cards stay read-only + a deep link at first. *Tell me if you want full interactivity on every card from day one.*

---

## Technology choices (where it is not obvious)

- **Slack Web API + Block Kit + OAuth v2.** Standard Slack stack. Bot token per workspace (encrypted at rest, envelope encryption like doc-5 OAuth connections). Posting via `chat.postMessage`; rich cards via Block Kit; button callbacks via an interactivity request URL.
- **Reuse the workflow engine (doc 10), don't build a notifier.** A Slack post is a doc-10.4 action; the deal-event triggers already exist (doc 9/10). So Slack is a thin adapter + a purpose-built mapping UI on top of workflows — reuse, not rebuild.
- **Secrets live in the superadmin key store (doc 13.3).** App client secret + per-workspace bot tokens are managed keys, encrypted, shown once.

## Data model (Prisma) — additions in this doc

Moved here from doc 11.

```prisma
model SlackConnection {      // NEW [NEAR-TERM] — a workspace's Slack OAuth + event map (this doc)
  id           String @id @default(cuid())
  workspaceId  String
  slackTeamId  String        // the connected Slack workspace's id
  teamName     String        // human-readable Slack workspace name (shown in Settings)
  botToken     String        // encrypted at rest (envelope encryption, like OAuthConnection doc 5)
  status       String  @default("connected") // "connected" | "disconnected" (text, app-validated — no db enum)
  eventMapJson Json           // [{ event: "won"|"stage_change"|"high_value"|"at_risk", channelId, conditions, isEnabled }]
  connectedAt  DateTime @default(now())
  @@index([workspaceId])
}
```

*Each `eventMapJson` row also compiles to a doc-10 `Workflow` (a "post to Slack" action) — the connection stores the map for the simple UI; the workflow engine runs it.*
