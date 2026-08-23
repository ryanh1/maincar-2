# Doc 8 — Developer Platform

Same format. This is the last pillar: the outside edge of the app. Everything the CRM, dialer, and AI store becomes reachable by code, by other apps, and by AI tools. Benchmarks are **Attio's API** and **Stripe's API** — the two cleanest developer surfaces to copy.

**Phase note:** everything here is **[P3]**. It ships after the solo app works. We re-sequence together later.

**Solo note:** still single-user. "Third-party app connects to a workspace" means *your* one workspace. Roles/teams stay parked under [LATER].

**Covers (from your list):** REST API with full CRUD on every object (API keys, auth header, pagination, filtering, rate limits, versioning); outbound webhooks on record + list events (subscription UI, retries, signing secret, delivery log); OAuth for third-party apps (auth-code flow, scopes, consent, app registration, refresh + revoke); an MCP server so AI tools read/write the workspace; read-only SQL over the Postgres protocol with an in-app query builder + result viewer; download any report as CSV.

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the page that tells the coding agent how to build it.

---

## New surfaces this adds

- **Settings → Developer** — a new settings area with four tabs: **API keys**, **Webhooks**, **OAuth apps**, **SQL access**.
- **Public REST API** at `api.{app}.com/v1` — every object, full CRUD.
- **MCP server endpoint** — a URL an AI tool (Claude Desktop, an IDE, etc.) points at.
- **Read-only SQL page** — a query builder + result grid inside the app (under Reports).
- **CSV download** — a button on every report and every table view.

---

## Journey 8.1 — Create an API key and call the REST API

**When you'd use it (examples):** a nightly script that pulls all Deals into a spreadsheet; Zapier creating a Person when a web form is filled; an internal tool bulk-updating deal stages.

1. Settings → Developer → **API keys → New key**.
2. He names it ("Zapier", "my script"), **picks scopes** (see the Scopes section), clicks **Create**.
3. The full key shows **once**, with a **Copy** button and a "you won't see this again" label; after that only a prefix `sk_live_a1b2…`. He can **revoke** any key.
4. He calls the API — `Authorization: Bearer sk_live_…`, base `…/v1` — with **full CRUD** on People, Companies, Deals, Calls, custom objects, records, lists, saved views. **Partial updates use `PATCH`** (send only the changed fields — never the whole record; adopted from Salesforce). Related data comes back in one call via **`?expand=`** and relationship field selection (Decision 1).
5. **Lists are cursor-paginated** (`?limit=&cursor=`). **Why a cursor, not `?page=`/`?offset=` (your question)?** An offset says "skip 200 rows" — but in a live CRM rows are inserted and deleted between page loads, so offset pages **skip or repeat rows**. A **cursor** encodes *where you stopped* (`(sortKey, id)`), so the next page continues exactly there regardless of inserts/deletes. It's the only correct choice for changing data — and what Attio, Stripe, and Salesforce (`nextRecordsUrl`) all do. The response returns an opaque `next_cursor`.
6. **Filters** use the saved-view AND/OR tree (`?filter=`). **Schema discovery:** a **`/describe`** endpoint returns each object's fields, types, and options, so a client builds forms and validates without hardcoding (adopted from Salesforce).
7. Responses carry **rate-limit headers** (`X-RateLimit-Remaining`); over the limit → **429** with `Retry-After`. The API is **date-versioned** (a key pins to its creation-date version; override via header).

- **Benchmark (beat this):** Attio REST API — overview — https://docs.attio.com/rest-api/overview ; Salesforce — REST (PATCH, describe) — https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest.htm ; Stripe — authentication — https://docs.stripe.com/api/authentication
- **Build docs:** Attio — pagination — https://docs.attio.com/rest-api/guides/pagination ; filtering & sorting — https://docs.attio.com/rest-api/how-to/filtering-and-sorting ; Stripe — rate limits — https://docs.stripe.com/rate-limits ; API versioning — https://stripe.com/blog/api-versioning

## Journey 8.1a — Sync your own business data into the CRM (upsert, external IDs, bulk)

**One of the most important use cases (your #6):** the customer injects *their own* business data so the CRM can report on it — activation/signup events from their app, revenue from Stripe, product usage, support tickets. Two capabilities make this clean, both adopted from Salesforce:

1. **External-id fields + upsert.** The customer flags a field as an **external ID** (unique, indexed) — e.g. `stripe_customer_id` on Company, or their app's `user_id` on Person — then **`PUT /v1/companies/by/stripe_customer_id/{value}`** to upsert: **0 matches → create, 1 → update, >1 → error (no silent duplicate).** Sync becomes **idempotent**: they replay their own key nightly and never create duplicates, without first querying to check existence. This is the single biggest enabler of safe customer sync; without it, every sync risks dupes.
   - **Why path variables, not query-params or a body field? (your question).** In REST, the URL *is the address of the resource* — `/companies/by/stripe_customer_id/cus_123` names *exactly one* company the same way `/companies/{id}` does, just by an alternate key. Three reasons this is the right shape: (a) **`PUT` semantics require it** — `PUT` means "make the resource at *this URL* look like the body"; the identity must live in the URL, and the changed fields in the body. Put the id in a query-param and you'd have `PUT /companies` with the identity smuggled into `?`, which no longer targets a resource. (b) **The field name (`stripe_customer_id`) and the value (`cus_123`) are two parts of one lookup key** — path segments express that hierarchy cleanly (`by/{field}/{value}`); a body field would blur "how to find it" with "what to change." (c) It **mirrors the benchmark** — Salesforce's `PATCH /sobjects/Account/ExternalId__c/{value}` does exactly this, so anyone who has synced Salesforce reads ours instantly. The **value is URL-encoded** (handles emails/slashes as external ids); if a customer's external-id value could itself contain unsafe characters at volume, they can fall back to the bulk API (body-based) — but for the common single-record upsert, path is correct.
2. **Bulk API for volume.** For large loads (100k activation events), an **async bulk job**: create job → upload NDJSON → poll → fetch success/failed results. It supports upsert-by-external-id too.
3. **An `Event` / activity object** (standard or custom) holds their events — `signed_up`, `activated`, `invited_teammate` — each linked to a Person/Company by external ID. Now the CRM can build the dashboards you described: **closed-won → activated conversion**, **retention cohorts** (reuse the cohort report, doc 5 Journey 5.9a), and **revenue tied to accounts** (join Stripe amounts onto Companies).
4. **Composite writes** create related records in one transactional call (a Company and its first Event together), later steps referencing earlier IDs.

**Examples this enables:** "when a user activates in our product, log an Event so we can chart close-won → activated"; "pull Stripe MRR onto each Company for a revenue dashboard"; "sync support tickets so reps see them on the account."

- **Benchmark (beat this):** Salesforce — upsert by external ID — https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_upsert.htm ; Bulk API 2.0 — https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/walkthrough_upload_data.htm ; Composite — https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_composite.htm
- **Build docs:** internal — a unique index on the external-id JSONB value; bulk jobs via pg-boss.

## Journey 8.2 — Subscribe to outbound webhooks

**When you'd use it (example):** the customer wants their own system to react in real time — when a Deal hits Closed-Won, ping their billing system to provision; or mirror every new record into their data warehouse.

1. In Settings → Developer → **Webhooks → New endpoint**, he pastes an **HTTPS** URL (we reject non-HTTPS and any URL resolving to a private/internal address — see risks below).
2. He picks events: `record.created`, `record.updated`, `record.deleted`, `list_entry.created`, `list_entry.deleted`; he can scope by object (only Deals).
3. **Verify ownership before we ever send:** the endpoint must echo a signed **verification challenge** once, so a user can't point us at someone else's server.
4. **Signing secret — the UI/UX you asked about:** on save we generate a **signing secret** `whsec_…` and show it in a modal with a **Copy** button, an optional **Download .txt**, and a clear **"You'll only see this once — store it now"** label. After the modal closes only a masked prefix shows, with **no reveal** — losing it means **rotate**. We support **two active secrets during rotation** so he can roll without downtime.
5. When a matching event fires, **job J1** POSTs the JSON with a `Signature` header (**HMAC-SHA256 over `timestamp.body`**) and a stable `event-id`; his server verifies the signature, rejects a stale timestamp (5-min window), and dedupes on `event-id`.
6. **Bad endpoints can't hurt us or him:** on non-2xx/timeout, J1 **retries with exponential backoff + jitter on a fixed budget** (8 attempts over ~24h), then **dead-letters**; an endpoint failing for **5 straight days auto-disables** (email warnings day 1 and 3). Delivery is **at-least-once and unordered** (documented — his server dedupes/reconciles).
7. The **delivery log** shows every attempt, status, and response, with **Resend** and **Send test event**.

*(Full risk analysis — SSRF, cost, reputation — is in Technical decisions → "Webhook delivery is the riskiest surface.")*

- **Benchmark (beat this):** Stripe — webhooks — https://docs.stripe.com/webhooks ; Svix — retries / auto-disable — https://docs.svix.com/retries ; Attio — webhooks — https://docs.attio.com/rest-api/guides/webhooks
- **Build docs:** Stripe — verify signatures — https://docs.stripe.com/webhooks/signature ; Svix — SSRF protection — https://www.svix.com/blog/ssrf-protection/

## Journey 8.3 — Connect a third-party app with OAuth

**When you'd use it (example):** a third-party app (a scheduling tool, a partner product, or your own SaaS) wants to act on a *user's* CRM data **without the user pasting an API key** — the user clicks "Connect," approves once, and the app gets a scoped, revocable token. API keys are for *your own* scripts; OAuth is for *other apps acting on a user's behalf*.

1. A developer registers an app in Settings → Developer → **OAuth apps** → **New app**: name, logo, redirect URL(s), requested scopes. He gets a **client ID** and **client secret**.
2. His app sends the user to `…/oauth/authorize?client_id=&scope=&redirect_uri=&state=`.
3. The user sees a **consent screen**: "**{App}** wants to *read your contacts* and *write deals*." He clicks **Allow** (or **Deny**).
4. On Allow, we redirect back with a short-lived **authorization code**. The app exchanges it (with its secret) at `…/oauth/token` for an **access token** + **refresh token**.
5. The app calls the REST API with the access token, limited to the granted scopes. When it expires, the app uses the **refresh token** to get a new one.
6. The user can **revoke** any connected app in the OAuth apps tab; its tokens die immediately.

**Implementation (your "one layer deeper" ask):** **don't hand-roll the OAuth server** — token issuance, PKCE, refresh, and revocation are security-critical, so use a vetted library (e.g. `node-oidc-provider`) or a hosted authorization server. Policies: **access tokens** short-lived (~1h), **refresh tokens** long-lived and **rotated on every use** (a used refresh token is invalidated; reuse detection revokes the chain), authorization **codes** single-use and ~60s, **PKCE required** for public clients. All secrets/tokens are stored **hashed** (Technical decisions), shown once. Revoke = mark the grant revoked → every derived token dies on the next check. This is the same flow the mailbox OAuth (doc 5) consumes as a client; here we are the **server**.

- **Benchmark (beat this):** Attio — connect an app through OAuth — https://docs.attio.com/rest-api/tutorials/connect-an-app-through-oauth
- **Build docs:** RFC 6749 — authorization code grant — https://datatracker.ietf.org/doc/html/rfc6749#section-4.1 ; Attio — authorize / token endpoints — https://docs.attio.com/docs/oauth/authorize

## Journey 8.4 — Let an AI tool read and write via MCP

**What the MCP server is (your question).** MCP (Model Context Protocol) is a standard way to hand an AI client a set of **tools** (functions it can call) and **resources** (data it can read), each with a machine-readable schema the client discovers automatically. Our MCP server is a small **remote server that wraps our REST API and presents it as those tools** — *not* a markdown doc. (Your guess — "a server that publishes a markdown file explaining our API for an AI" — is close in spirit but off: it isn't docs the AI reads, it's **live tools the AI calls**, with real auth and real writes.)

**Why build it when we already have the API (your question).** The API lets a **developer write code**. The MCP server lets **any MCP-compatible AI (Claude Desktop, Claude Code, Cursor, an IDE) use the workspace with zero integration code** — the user pastes one URL and the AI can immediately search, create, and update records, because the tools are self-describing and the auth is standard. Without MCP, every AI tool would need a person to hand-write an integration against our REST API. MCP is the difference between "a programmer can integrate us" and "an AI can use us out of the box." **Example:** a rep runs Claude Desktop, points it at the MCP URL, and says "summarize my open deals and draft follow-ups" — no code, it just works.

1. The user goes to Settings → Developer and copies the **MCP server URL** for his workspace.
2. He pastes it into an MCP client. The client authenticates with an OAuth token (Journey 8.3) or an API key, scoped to **his one workspace**.
3. The AI tool discovers **tools** (`create_record`, `update_record`, `search`, `log_call_note`, `run_report`) and **resources** (objects, saved views, a record's timeline).
4. He asks his AI: "add these five leads to the *Q3* list." The AI calls the MCP tools; **those writes go through the same API and land on the same records the app UI shows — MCP is just another door into the one workspace, not a separate copy.** *(This is what the old "rights land in the same record the app UI reads" line meant — badly worded; fixed.)*
5. Every scope is enforced server-side — a read-only connection cannot write. The exposed AI model is the client's own; our built-in AI features still use the super-admin-set backend model (global edit).

- **Benchmark (beat this):** Model Context Protocol — specification — https://modelcontextprotocol.io/specification
- **Build docs:** MCP — architecture (tools/resources) — https://modelcontextprotocol.io/docs/learn/architecture ; MCP — authorization — https://modelcontextprotocol.io/specification/draft/basic/authorization ; **use the official MCP TypeScript SDK, don't hand-roll** — https://github.com/modelcontextprotocol/typescript-sdk

## Journey 8.5 — Query the workspace with read-only SQL

**Are we losing programmatic query-over-API by not exposing SOQL/jsforce-style raw SQL? No — and this answers your question directly.** Programmatic querying **is** a first-class API feature; it just doesn't take *raw SQL strings*. There are two query paths and this journey is only the third-and-optional one:

- **`GET /v1/{obj}?filter=…`** — query with the AND/OR filter tree in the query-string, for simple reads (Journey 8.1).
- **`POST /v1/{obj}/query`** — **this is the jsforce/SOQL equivalent.** You send a **filter tree in the request body** (too big/complex for a URL), pick fields, traverse relationships (`contact.company.name`), sort, and cursor-paginate — a full structured query, over the API, from code. This covers everything a script or the SDK needs to "query the CRM." A developer who reaches for `conn.query("SELECT … WHERE …")` in jsforce reaches for `POST /v1/{obj}/query` here. So the "query data over API" feature is **not missing — it's the filter tree, expressed as JSON instead of a SQL string.**
- **Why a filter tree instead of accepting a raw SQL/SOQL string over the API?** A raw-SQL endpoint is a parser-and-injection surface, is hard to rate-limit and cache (every string is unique), and would let any caller write arbitrarily expensive joins against the primary. The JSON filter tree is validated field-by-field, maps to indexed columns, caches cleanly, and is the *same* tree the saved-view UI emits — so the API and the app never diverge. This is the deliberate Attio-style choice, and we lose nothing a real integration needs.

**Then what is *this* journey (8.5) for?** A **separate, optional read-only SQL surface for ad-hoc human analysis and BI** — an in-app query box **and** an external Postgres connection — over a **read replica** (Decision 2), never the primary. It exists for the cases the structured query deliberately won't do: a human typing a one-off `GROUP BY` join, or pointing Metabase/Tableau at the data. So there are **three** query surfaces, in order of who uses them: `?filter=` (simple API reads), `POST /{obj}/query` (structured programmatic query — the SOQL equivalent), and read-only SQL (human/BI ad-hoc).

**When you'd use it (example):** a one-off analysis ("average days-in-stage by source last quarter"), or pointing Metabase / a BI tool at your CRM data.

**Guardrails (injection / cross-org — your question):** because the query *is* the user's input, we don't "sanitize" it — we **contain** it: a `SELECT`-only role, **row-level security pinned to `workspace_id`** (so a crafted query cannot read another workspace), a **statement timeout**, a **row cap**, and no DDL/DML. Worst case, a malicious query reads only the caller's own rows, slowly.

1. Under Reports, the user opens **SQL**. He picks tables (People, Deals, Calls…) in a **query builder**, or types SQL directly.
2. He runs it. Results show in a **result grid** he can sort, and **download as CSV**.
3. Every query is **read-only** and runs against a **read replica** (never the primary), under a role that can only `SELECT` and only sees **his workspace's rows** (row scoping). No `DROP`, no cross-workspace leak.
4. Guardrails: a **row cap**, a **statement timeout**, and a blocked-keyword list. He can **save** a query to re-run later.
5. Power users can also connect an external SQL client to the same read-only endpoint over the Postgres wire protocol.

- **Benchmark (beat this):** Attio — REST filtering as the no-SQL alternative — https://docs.attio.com/rest-api/how-to/filtering-and-sorting
- **Build docs:** PostgreSQL — high availability / hot-standby replicas — https://www.postgresql.org/docs/current/high-availability.html ; frontend/backend wire protocol — https://www.postgresql.org/docs/current/protocol.html

## Journey 8.6 — Download a report as CSV

**When you'd use it (example):** email a weekly pipeline CSV to a stakeholder, or pull a filtered list into Excel for a one-off analysis.

1. On any **report** (from doc 5's reporting) or any **table view**, the user clicks **Export → CSV**.
2. Small results download right away. Large ones run as **Background job J5**; when ready he gets a notification and a download link.
3. The CSV respects his current columns, filters, and sort — what he sees is what he gets.

- **Benchmark (beat this):** Stripe — export data / reports — https://docs.stripe.com/reports
- **Build docs:** internal — reuses doc 5 (CRM comms) reporting; stream rows to CSV.

---

## Journey 8.7 — Scopes, permissions & authorization (your questions on 8.1 / 8.2 / 8.3)

*As an admin issuing an API key or approving a connected app, I want to grant only the exact objects and actions the integration needs, so that a leaked key or a rogue app can't do more than I intended.*

**Scopes gate what a key or token can do**, on every auth path:
- **API keys (8.1):** the user picks scopes when creating the key.
- **OAuth apps (8.3):** the app **registers** the scopes it may request; at connect time the **consent screen** lists them and the user grants (or narrows) them.
- **MCP (8.4):** the connection inherits the scopes of its underlying API key / OAuth token.

**The scope catalog (`object:action`):**
- `records:read` / `records:write` — the common pair.
- **Per-object narrowing:** `deals:read`, `deals:write`, `people:read`, `calls:read`, … so a key can be limited to one object.
- `lists:read` / `lists:write`, `views:read`.
- `reports:read` — run reports and read-only SQL.
- `webhooks:manage` — create/delete webhook endpoints.
- `admin` — manage the data model, integrations, and other keys (rarely granted).

**Validation & authorization (who may hold which scope):**
- An **OAuth app can only request scopes it registered for**; anything else is rejected at `/authorize`.
- A **key/token can never exceed the granting user's own permissions** — scopes are capped by what that user can do. Solo today = one **owner** with all scopes. **With teams [LATER], scopes are capped by role** (a member can't mint an `admin` key) — that's exactly where "does the user's role matter?" becomes yes.
- Every request — key, OAuth token, or MCP — resolves to the same **`scopes` + `workspaceId`** middleware check.
- **Least privilege by default:** the create-key UI defaults to read-only and nudges "only grant write if your script needs it."

## Journey 8.8 — API reference: the schemas (endpoints, webhook events, MCP tools)

*As a developer integrating against MainCar, I want one authoritative list of every endpoint, event, and tool — with the rules that govern all of them — so that I can build without guessing or reading source.*

*(You noted these were missing. This is the contract; the full OpenAPI spec is generated from it — see "API documentation" in tech choices.)*

**REST endpoints (per object `{obj}` ∈ people | companies | deals | calls | actions | `<custom>`):**

| Method + path | Does |
|---|---|
| `GET /v1/{obj}` | list (cursor pagination, `?filter=`, `?expand=`, `?sort=`) |
| `POST /v1/{obj}` | create |
| `GET /v1/{obj}/{id}` | fetch one (`?expand=`) |
| `PATCH /v1/{obj}/{id}` | partial update |
| `DELETE /v1/{obj}/{id}` | delete (to 30-day trash) |
| `PUT /v1/{obj}/by/{extIdField}/{value}` | **upsert by external id** (8.1a) |
| `POST /v1/{obj}/query` | complex read (filter tree in body) |
| `GET /v1/{obj}/describe` | schema (fields, types, options) |
| `POST /v1/bulk` | async bulk create/update/upsert (8.1a) |
| `POST /v1/composite` | several writes in one transactional call |
| `GET /v1/lists`, `/v1/lists/{id}/entries` | lists + membership |
| `POST /v1/reports/{id}/run` | run a saved report |
| `GET /v1/limits` | remaining rate-limit budget |

**How the non-obvious endpoints work, and why each exists (your question):**

- **`POST /v1/bulk` — async bulk.** The plain `POST /v1/{obj}` writes *one* record per HTTP call. Loading 100k activation events that way is 100k round-trips and would eat your whole rate-limit budget. `POST /v1/bulk` instead takes a **job**: you `POST` to open a job (naming the object, the operation, and — for upsert — the external-id field), stream up **NDJSON** (one JSON record per line) to it, then **poll** the job until it finishes and fetch two result files, `success` and `failed`. It runs **off-request on pg-boss** (job in the 8.1a flow), so a million-row load can't tie up a web worker. Use it whenever you have more than ~a few hundred rows. *Why it exists:* volume sync without hammering the per-record API.
- **`POST /v1/composite` — transactional multi-write.** Several *different* writes that must **all succeed or all fail together**, in one HTTP call, where **later steps reference earlier steps' new IDs** (create a Company, then create its first Event pointing at that Company's just-minted id — without a second round-trip to learn the id). The whole batch runs in **one DB transaction**: any step fails → the whole thing rolls back, so you never get a Company with no Event or an Event orphaned from its Company. *Why it exists:* referential integrity across related creates, and fewer round-trips. (Bulk = many of the *same* op, non-transactional, async, huge volume. Composite = a few *different* ops, transactional, synchronous, small. Different tools.)
- **`GET /v1/lists`, `GET /v1/lists/{id}/entries` — lists + membership.** A *list* is a saved collection of records (a "Q3 target accounts" list). `GET /v1/lists` enumerates the lists; `GET /v1/lists/{id}/entries` pages the records *in* one list (each entry links a record to the list, and can carry list-specific fields like a stage). *Why separate from `GET /v1/{obj}`:* membership is a many-to-many relationship, not a property of the record — a Person can sit on five lists — so it needs its own address. Writes go through `POST /v1/lists/{id}/entries` (add) / `DELETE` (remove).
- **`POST /v1/reports/{id}/run` — run a saved report.** Reports are built in the app (doc 5b). This runs one **by id** and returns its computed rows as JSON (or, with the CSV path, a file). It takes runtime parameters (date range, filters) in the body so one saved report serves many queries. *Why it exists:* let a script or dashboard pull the *same numbers the app shows* without re-implementing the report's aggregation logic — the report definition stays the single source of truth.
- **`GET /v1/limits` — remaining budget.** Returns your **current rate-limit standing** — remaining requests in the window and reset time — *without spending a meaningful call*, plus any bulk/concurrency ceilings. *Why it exists:* a well-behaved bulk client checks `/limits` and paces itself instead of blindly hitting 429s. Same idea as Salesforce's `/limits`. (Every normal response also carries `X-RateLimit-Remaining`; this endpoint is for checking *before* a big job.)

**How every endpoint behaves — the rules that apply across the whole API (your "what else do we need to know" question):**

- **Data validation.** Every write is validated against the object's schema *before* it touches the DB: required fields present, types coerced or rejected, select-options must exist, unique/external-id constraints enforced, relationship targets must resolve to real records in *your* workspace. A bad write returns **`422` with a field-level error list** (`{ field, code, message }`) — never a partial write. The rules come from the **same `AttributeDef` schema the app UI validates against**, so the API can't accept data the UI would reject (or vice-versa). `POST /{obj}/describe` exposes these rules so a client can validate locally first.
- **Enforcement is server-side and per-workspace, always.** Every request — key, OAuth token, or MCP — resolves through the one middleware to a **`(scopes, workspaceId)`** pair, and **every query is filtered by that `workspaceId`** at the data layer. There is no code path that returns another workspace's data; the workspace scope is not a filter the caller supplies (and could omit) — it's injected from the credential. Scope checks (`records:write`, `deals:read`, …) run on top of that. A read-only credential physically cannot reach a write handler.
- **Is *all* data from *all* objects returned? No — it's scoped three ways.** (1) **Workspace:** only your workspace's records, ever. (2) **Object + field visibility:** the API exposes the same objects and fields the workspace's data model defines, including custom objects/fields; there is no hidden "system" data leaking through. (3) **Scope:** a per-object scope (`people:read` without `deals:read`) further narrows which objects a given credential may touch. So a key sees *its permitted objects, in its one workspace, for its granted actions* — nothing more.
- **Can you access data not visible to you? No.** Today (solo) the owner can see everything in their own workspace, so "not visible to you" means **other workspaces** — and that's blocked by the `workspaceId` injection above; even a crafted filter or a raw SQL attempt (8.5) is pinned by row-level security. **[LATER, with teams]** record- and field-level visibility rules from the permissions doc (doc 11) apply **identically** to the API: the API resolves the *acting user's* visibility and filters to it, so a member's key can never read a record the app would hide from that member. The API is never a back-door around the permission model — it runs *through* it.
- **Deleted records** go to a 30-day trash (`DELETE` is soft); they stop appearing in reads immediately and emit `record.deleted`. **Soft-deleted rows are never returned** by list/query/expand.
- **Idempotency.** Unsafe `POST`s accept an **`Idempotency-Key` header**; a retried request with the same key returns the original result instead of double-creating (Stripe's model) — important because network retries are normal.

**Webhook event catalog (this is the "webhook reference" — same cross-cutting rules apply):** `record.created`, `record.updated`, `record.deleted`, `list_entry.created`, `list_entry.deleted` (plus, later, `deal.stage_changed`, `call.completed`). Payload: `{ id, type, created, api_version, data: { object } }`, signed `HMAC-SHA256(timestamp.body)`.

- **Events are scoped and filtered the same way reads are.** A webhook only ever fires for records **in the subscribing workspace**, respects the endpoint's optional object filter, and **[LATER]** carries only fields the subscription's credential may see — a webhook is not a way to exfiltrate data the API itself would withhold.
- **The payload is validated/shaped by `api_version`.** Each delivery stamps the `api_version` the subscription is pinned to, so the object shape is stable even as the schema evolves — a receiver written today keeps parsing next year's deliveries.
- **Delivery guarantees (repeated here because integrators must design for them):** **at-least-once, unordered**; dedupe on the stable `event-id`, and if you need strict ordering, sort by `created` or re-fetch the record — never assume arrival order equals event order.

**MCP tools:** `search`, `get_record`, `create_record`, `update_record`, `upsert_record`, `add_to_list`, `log_call_note`, `run_report`. **MCP resources:** `objects`, `saved_views`, `record://{obj}/{id}/timeline`. Each tool's JSON schema is generated from the REST contract, so the two never drift — and because they wrap the same handlers, **the validation, workspace-scoping, and visibility rules above apply to MCP calls unchanged**. An AI tool cannot read or write anything the underlying key/token couldn't.

---

## Background jobs

- **J1 — Webhook delivery.** On each subscribed event, sign and POST the payload; retry with exponential backoff up to 3 days; dead-letter after. Log every attempt.
- **J2 — Rate-limit accounting.** Count requests per API key in a rolling window; return remaining in headers; 429 over the limit.
- **J3 — Token & key housekeeping.** Expire OAuth access tokens, rotate on refresh, purge revoked tokens and dead auth codes. Periodic.
- **J4 — API request log.** Write method, path, key, status, and latency for each API call, for the developer's activity view and abuse detection. Async.
- **J5 — CSV export build.** For large reports, build the CSV off-request, store it, and notify with a signed download link.

---

## Decisions for you (developer platform)

**1. API shape — REST or GraphQL? — Decided: REST.** You asked the right question: GraphQL shines when data is **highly relational** and a client must hop object→object and fetch exactly the fields it needs in one round-trip. Your instinct is correct — but we get the useful part of that in REST **without** GraphQL's cost, by borrowing Salesforce's approach:

**The relational use cases, and how REST satisfies each:**
- *"Get a Company with its People and open Deals in one call"* → an **`?expand=people,deals`** (include) parameter that embeds related records — one round-trip, no N+1.
- *"Get calls, each with the contact's name and company"* → **relationship field selection**: request `contact.name`, `contact.company.name` (parent dot-walking, Salesforce-style), returned inline.
- *"Get a Deal and all its activities"* → a **child subquery / nested include**.
- *"Filter people by a related field"* (company in a segment) → the same **AND/OR filter tree** from saved views, which can reference related fields.

So **REST + expand/include + relationship-field selection** covers the multi-hop cases GraphQL is picked for, while staying trivial for scripts, Zapier, and the AI to call — and easy to cache and rate-limit. GraphQL would be one flexible endpoint but heavier to build, secure, cache, and rate-limit for a solo app, and you don't want to write it. **REST it is.**

**2. Read-only SQL — how do we serve it? — Decided: a read replica + a scoped read-only role.** You had a lot of good questions here, so the full explanation:

**What a read replica is.** Postgres can run a **second copy of the database** that continuously receives a stream of changes from the primary and stays nearly in sync. It is **read-only** and it's a **built-in Postgres feature** (streaming replication) — on a managed host (RDS / Cloud SQL / Neon) it's essentially a checkbox, **not a new service we build or operate**. That's what "not another service to run" meant.

**You've understood it correctly:** developer/BI SQL hits the **replica**, never the primary that serves live calls and the app.

**Why (the real reasons, ranked):**
1. **Isolation / performance — the main one.** A heavy analytical `SELECT` (scanning a year of calls) runs on the replica and **can't slow down or lock the live app**; the primary keeps serving calls at full speed.
2. **Blast-radius safety.** The connection uses a role that can only `SELECT` and only sees the workspace's rows, so a mistake or malicious query **cannot write, drop, or read another workspace**. (SQL injection is less the point — here the query *is* the user's input; the protection is the read-only + row-scoped role, not sanitizing.)
3. **Clean scaling.** More analytics load → add replicas, without touching the primary.

**Downside — staleness.** A replica lags by **replication lag**, usually well under a second (sometimes a few seconds under load), so SQL results can be **a moment behind live** — fine for reporting/BI, which is all this serves. To-the-millisecond needs use the REST API against the primary.

**"More control" was about the alternative** — a Postgres-compatible **query proxy/gateway** (custom limits, query rewriting) but **a whole service to build and secure**. Not worth it now.

**Not a data warehouse** — just a **Postgres read replica**, same schema. A warehouse (BigQuery/Snowflake) is a later option only if analytics truly outgrow Postgres.

**3. API auth — keys or OAuth?**
- **Support both (my pick).** API keys for the user's own scripts; OAuth tokens for third-party apps. Same scope model underneath.
- **OAuth only.** Cleaner, but overkill for "run my own script."

**4. Webhook + export delivery — where does it run? — Reconsidered (your push-back).** You're right that these must run **off the main server thread** — a slow webhook endpoint must never block a web request — so they go on a **queue with a worker**. The options, plainly:

- **A plain queue** — enqueue → a worker picks it up → on failure, retry with backoff → after N failures, dead-letter. The unit of retry is the whole job. This is all a webhook POST or a CSV build needs. Implementations: **BullMQ** (fast, but needs **Redis** — a new service to run), or **pg-boss / Graphile Worker** (Postgres-backed, **no new infra**). This is the "library with its own job queue" family you used before.
- **Durable execution** (**Trigger.dev**, Inngest) — checkpoints **each step**, so a crash resumes mid-workflow and "sleep 3 days, then continue" survives restarts/deploys. Great for **complex multi-step workflows**; overkill for a single POST-and-retry. Trigger.dev is OSS/self-hostable but its cloud bills **per run** (gets pricey at webhook volume); Inngest is closed-source, cloud-only.
- **My pick: pg-boss** (Postgres-backed, MIT). Webhook delivery and CSV export are single-step-with-retry, so a plain queue covers them completely. pg-boss gives reliable retries, backoff, cron, and dead-letter **on the Postgres we already run** — **no Redis, no per-run cost, no lock-in** — and jobs are durable rows we can enqueue in the same transaction as the change that triggered them, so nothing is lost. (Graphile Worker is an equally fine Postgres-only pick.)
- **The honest trade-off:** we give up true *durable execution*. The day we build a genuinely complex multi-step workflow (long approval flows, multi-service sagas), we'd be hand-rolling step-checkpointing and durable timers on pg-boss — exactly what Trigger.dev gives for free. If that day comes, **self-hosted Trigger.dev** is the OSS way to get it (it adds Redis to the self-host stack). Don't pay that complexity now for a POST-and-retry.
- **This revises the at-scale doc's job-runner choice** (which named Trigger.dev/Inngest). Same logic applies to the dialer's bulk jobs — prefer pg-boss unless a step-checkpointed workflow actually appears. Noted as a change to that doc.

---

## Technology choices (where it is not obvious)

Builds on the whole stack (React + Vite SPA + TS API, Postgres+Prisma, the hosted durable job runner from the at-scale doc). New decisions:

- **API style — REST, not GraphQL.** *Options:* REST vs GraphQL. **Pick REST** (Decision 1): resource-per-object CRUD, cursor pagination, filter tree in query params. It mirrors the two benchmarks, is trivial for the AI and no-code tools to call, and is cache- and rate-limit-friendly. The internal filter engine already built for saved views is reused for `?filter=`.
- **Read-only SQL — read replica + scoped role, not a proxy.** *Options:* (a) read replica + a `SELECT`-only role with row-level security; (b) a Postgres-compatible gateway; (c) let queries hit the primary. **Pick (a)** (Decision 2): a replica absorbs analytical load off the primary, RLS enforces per-workspace scoping, and the wire protocol means any SQL client just works.
- **Webhook + CSV delivery — pg-boss (a Postgres-backed queue), not a hosted durable runner.** *Options:* hosted durable execution (Trigger.dev/Inngest) vs BullMQ (needs Redis) vs pg-boss/Graphile Worker (Postgres-only). **Pick pg-boss** (Decision 4): J1 retries/backoff/dead-letter and J5 exports are single-step-with-retry, so a plain Postgres-backed queue covers them — no Redis, no per-run cost, no lock-in, jobs enqueued transactionally with the change. Reach for **self-hosted Trigger.dev** only if a genuinely multi-step, checkpointed workflow appears. This **revises the at-scale doc's runner choice**.
- **OAuth server — a library, not hand-rolled.** *Options:* build the auth-code flow from scratch vs a vetted library/provider (e.g. `node-oidc-provider` / a hosted authZ server). **Pick a library.** Token issuance, refresh, revoke, and PKCE are security-critical; use audited code.
- **MCP transport — Streamable HTTP, not stdio (what these mean).** An MCP server talks to its client over a **transport**. **stdio** = the server runs as a **local subprocess on the same machine** and communicates over standard input/output — great for a tool bundled into your IDE, but it can't be a shared remote service. **Streamable HTTP** = the server is a **normal HTTPS endpoint** any client connects to over the network (it can stream responses; it replaced the older HTTP+SSE transport). **Pick Streamable HTTP:** ours is a remote, multi-user server that needs OAuth, rate-limiting, and audit at the server tier — exactly what an HTTP endpoint provides. stdio is only for local single-process tools.
- **API auth — API keys and OAuth tokens, one scope model.** Both resolve to the same `scopes` + `workspaceId` check in middleware (Decision 3).
- **Benchmark: Salesforce API + jsforce — what we adopt and skip.** We grade this platform against Salesforce's REST API and the **jsforce** SDK (at least as good, ideally better). **Adopt:** upsert-by-external-id (8.1a), first-class external-id fields, `PATCH` partial-update, opaque **cursor** pagination, a `/describe` endpoint, relationship traversal (expand + parent dot-walking + child subqueries), async **bulk**, **composite/transactional** multi-writes, outbound events with a **replay cursor** so a receiver catches up after downtime, and a `/limits` endpoint. **Ship an official SDK** — a thin, jsforce-style TypeScript client (connection + auto token-refresh + auto-pagination) as the default path, with raw REST as the contract. **Skip deliberately:** legacy streaming variants (one modern webhook + stream, not three); per-version URL namespacing with dozens of live versions (use header-based versioning + a short support window); CSV-as-bulk-format and exposed governor row-limits (default NDJSON + soft, observable limits).
- **API documentation — generated, not hand-written.** One **OpenAPI / JSON-schema** definition is the source of truth; the docs site, the SDK types, and the MCP tool schemas are all generated from it, so they never drift. (Yes, we need docs — a Stripe/Attio-grade reference is table stakes for a developer platform.)
- **Rate limiting — self-implemented middleware, not an API gateway (yet).** *Options:* a managed API gateway/manager (Kong, AWS API Gateway) vs a sliding-window counter in our own middleware. **Pick middleware:** a per-key sliding-window counter (in Postgres now, Redis if throughput demands) is simple, free, and enough at solo scale; a gateway adds a service and cost for analytics/transformation we don't need yet. Job J2 does the accounting; headers report remaining. A gateway is worth it only at much higher scale.
- **API request log (J4) — structured rows, not plaintext.** Write one **structured `ApiRequestLog` row** per call (method, path, key, status, latency), queryable for the developer's activity view and abuse detection. Plaintext files aren't queryable and can't power a UI. It's a Postgres table + index now; move to a columnar store (ClickHouse) only if volume demands, on its own retention clock.

## Data model (Prisma) — additions in this doc

Extends the cumulative schema. **New models are marked `// NEW`.** Existing models (`User`, `Workspace`, `ObjectDef`, `Record`, `SavedView`, `ListEntity`, `Report`) are **not** redefined; new models reference them.

```prisma
model ApiKey {              // NEW — Journey 8.1 (own-script auth)
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  prefix      String            // shown in UI: "sk_live_a1b2"
  hashedKey   String            // never store the raw key — hash it
  scopes      String[]          // ["records:read","records:write", ...]
  lastUsedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
  @@index([workspaceId])
}

model OAuthApp {             // NEW — Journey 8.3 app registration
  id            String   @id @default(cuid())
  workspaceId   String            // owner (solo: the one workspace)
  name          String
  logoUrl       String?
  clientId      String   @unique
  hashedSecret  String            // hash the client secret
  redirectUris  String[]
  scopes        String[]          // scopes this app may request
  createdAt     DateTime @default(now())
}

model OAuthGrant {           // NEW — a user's consent to an app (Journey 8.3.3)
  id          String   @id @default(cuid())
  appId       String
  workspaceId String
  scopes      String[]          // scopes actually granted
  createdAt   DateTime @default(now())
  revokedAt   DateTime?
  @@unique([appId, workspaceId])
}

model OAuthToken {           // NEW — issued access / refresh tokens
  id          String   @id @default(cuid())
  grantId     String
  kind        String            // access | refresh
  hashedToken String            // hash, never raw
  scopes      String[]
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
  @@index([grantId])
}

model WebhookSubscription {  // NEW — Journey 8.2 endpoint
  id            String   @id @default(cuid())
  workspaceId   String
  url           String
  events        String[]          // record.created, list_entry.deleted, ...
  objectFilter  String?           // optional: only this object
  hashedSecret  String            // signing secret (whsec_...), hashed
  hashedSecret2 String?           // second active secret during rotation
  verifiedAt    DateTime?         // ownership challenge passed (before we send)
  isActive      Boolean  @default(true)
  disabledAt    DateTime?         // auto-disabled after 5 days of total failure
  createdAt     DateTime @default(now())
}

model BulkJob {              // NEW — Journey 8.1a async bulk (create/update/upsert)
  id            String   @id @default(cuid())
  workspaceId   String
  objectSlug    String
  operation     String            // create | update | upsert
  extIdField    String?           // for upsert-by-external-id
  state         String   @default("open") // open | uploading | processing | done | failed
  resultKey     String?           // stored success/failed results
  createdAt     DateTime @default(now())
}

// External-id fields (Journey 8.1a) are ordinary AttributeDefs flagged
// isExternalId + isUnique, backed by a unique index on the extracted JSONB value,
// so PUT /v1/{obj}/by/{extIdField}/{value} upserts idempotently.

model WebhookDelivery {      // NEW — Journey 8.2 delivery log / job J1
  id             String   @id @default(cuid())
  subscriptionId String
  event          String
  payloadJson    Json
  status         String            // pending | success | failed | dead
  attempts       Int      @default(0)
  responseCode   Int?
  nextRetryAt    DateTime?
  createdAt      DateTime @default(now())
  @@index([subscriptionId, status])
}

model McpConnection {        // NEW — Journey 8.4
  id          String   @id @default(cuid())
  workspaceId String
  label       String
  authRef     String            // -> ApiKey.id or OAuthToken.id
  scopes      String[]          // caps what the AI tool can do
  lastSeenAt  DateTime?
  createdAt   DateTime @default(now())
}

model SqlReadRole {          // NEW — Journey 8.5 (the scoped replica role)
  id           String   @id @default(cuid())
  workspaceId  String   @unique
  roleName     String            // per-workspace SELECT-only role on the replica
  rowScope     String            // RLS predicate: workspace_id = '...'
  statementTimeoutMs Int   @default(15000)
  rowCap       Int      @default(100000)
}

model SavedQuery {           // NEW — Journey 8.5 saved SQL
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  sql         String
  createdAt   DateTime @default(now())
}

model ApiRequestLog {        // NEW — job J4
  id          String   @id @default(cuid())
  workspaceId String
  keyId       String?           // ApiKey or OAuthToken id
  method      String
  path        String
  status      Int
  latencyMs   Int
  apiVersion  String?
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
}
```

## Technical decisions, trade-offs & edge cases

- **Never store raw secrets.** API keys, client secrets, OAuth tokens, and webhook signing secrets are shown **once** and stored **hashed** (`hashedKey`, `hashedSecret`, `hashedToken`). Lookups hash-then-compare. Losing a secret means rotating, not recovering.
- **Webhook delivery is the riskiest surface — your questions, analyzed.** Sending HTTP to servers *the customer controls* is the one place we act on untrusted input, so it gets the most guardrails:
  - **Bad/broken endpoints (do we burn money retrying?).** No — retries are a **fixed budget with backoff + jitter**: 8 attempts over ~24h (`0s, 15s, 1m, 5m, 30m, 2h, 6h, 12h`), then **dead-letter**. An endpoint that fails for **5 straight days auto-disables**. So a dead endpoint costs a bounded handful of attempts, not an unbounded loop. Cost is further bounded by a **5s connect / 15s total timeout**, a **per-endpoint concurrency cap**, and a **circuit breaker** (open at >50% failures/min, half-open after 60s).
  - **Could we get IP-blocked (reputation)?** Yes, if we blast bad endpoints from shared IPs. Mitigations: route webhook egress through **dedicated IPs** (isolated from our mail/other traffic), auto-disable failing endpoints fast, and **verify endpoint ownership** (signed challenge) before we ever send.
  - **SSRF — the scary one.** A customer could register `http://127.0.0.1`, `169.254.169.254` (cloud metadata), or a private `10.x`/`192.168.x` address and make *our* server call *our* internals. Guard at **both** points: at **registration**, require HTTPS and reject URLs resolving to loopback/RFC1918/link-local; at **delivery**, **re-resolve DNS and re-check the resolved IP** (defeats DNS-rebinding) and **disable redirects** (treat 3xx as failure). Svix's default subnet blocklist is the model.
  - **Guarantees:** at-least-once, **unordered**; every event carries a stable `event-id`; sign `timestamp.body` (HMAC-SHA256), 5-min replay window, **dual secrets during rotation**.
- **Rate limits are per key** (J2), not per workspace, so one runaway script cannot starve the others. Return `X-RateLimit-Remaining`; 429 with `Retry-After`. *(Metering/billing stays deferred to the very end — rate limits here are for stability, not charging.)*
- **Read-only SQL must not touch the primary or leak rows.** Queries run on a **read replica** under a `SELECT`-only role with **row-level security** pinned to `workspace_id`, plus a statement timeout and row cap. Even a crafted query cannot write, cross workspaces, or knock over live calling. This is the one place a mistake is catastrophic — scope it twice.
- **API versioning + deprecation.** Date-based versions; a key pins to the version live when created; requests can override with a header. Old versions keep serving; deprecations get a sunset date and a warning header. Same model Stripe uses.
- **MCP auth maps to workspace scopes.** An MCP connection authenticates as an API key or OAuth token and inherits exactly those scopes and that one `workspaceId`. A read-only token yields read-only tools. The exposed model is irrelevant to permissions — the **model is super-admin-set on the backend** (global edit); MCP only brokers access to the workspace.
- **Pagination cursor stability.** List cursors encode `(sortKey, id)`, not a numeric offset, so inserts and deletes between pages don't skip or repeat rows. Filters are the saved-view AND/OR tree, reused so the API and the UI never diverge.
- **Change forced on an earlier doc:** the at-scale doc's durable job runner now also owns **webhook delivery (J1)** and **CSV export (J5)** — noted so its job list is read as extended, not fixed. No other earlier decision changes.

---

## Open specifics — resolved so this is buildable (your "what else is under-specified?" question)

These were the remaining blanks a coding agent would trip on. Each is pinned to a concrete starting value (all tunable later, per your standing note).

**Concrete limits & defaults**
- **Rate limit:** **10 requests/second, burst 50, per API key** (sliding window, J2). OAuth tokens share the granting app's bucket per workspace. Over → `429` + `Retry-After`. `/limits` reports remaining. (Attio/Stripe sit in this range; start here, watch J4 logs, raise if needed.)
- **Bulk API:** up to **10M rows or 1 GB per job**, **NDJSON only**, result files kept **7 days** then purged, **max 5 concurrent jobs per workspace** (queued beyond that). A job with >10% failed rows still completes — you read the `failed` file and re-submit.
- **Composite:** up to **25 sub-requests** per call (Salesforce's ceiling), all in one transaction.
- **Webhooks:** up to **20 endpoints per workspace**, payload **≤ 256 KB** (oversized → we send a thin `{id,type}` and the receiver re-fetches), timeouts **5 s connect / 15 s total**.
- **Pagination:** `?limit=` default **50**, max **200**. `?expand=` depth capped at **2 hops** and **25 embedded children** per parent (deeper → use `POST /{obj}/query` or a second call), so one request can't fan out unboundedly.
- **Sparse fields:** `?fields=` (comma-list) returns only named fields; default returns all standard fields, related data only when `expand`ed.

**Standard error envelope** (every 4xx/5xx): `{ error: { type, code, message, field?, request_id } }` — `type` ∈ `invalid_request` | `authentication` | `permission` | `rate_limit` | `not_found` | `conflict` | `server`; `request_id` matches the J4 log row so support can trace it. `422` carries a `errors[]` array of `{field,code,message}`.

**Versioning:** first public version **`2026-01-01`**; a key pins to the version live when it was created; a request may override with a `MainCar-Version:` header. New versions only for **breaking** changes; additive fields ship un-versioned. Deprecated versions serve for **≥12 months** with a `Sunset` header. (Stripe's model, Decision from tech choices.)

**OAuth consent screen:** hosted by us at `…/oauth/authorize`, shows the app's registered name + logo and the human-readable scope list; solo = **no app-review/verification gate** (any registered app can request consent). App verification/publisher badges are **[LATER]** with teams/marketplace.

**MCP auth:** the client authenticates with **either** an API key (`Authorization: Bearer sk_…`) **or** an OAuth access token; `search` and list-style tools are **cursor-paginated** like the REST list endpoints (the AI passes `cursor` to page), so a large workspace doesn't blow the model's context in one call.

**API key creation UI:** the New-key modal has a name field, a **scope picker grouped by object** (checkboxes: read/write per object, plus `lists`, `reports`, `webhooks:manage`, `admin`), defaulting to `records:read` only; **Create** reveals the raw key once (Journey 8.1.3). Reused for editing scopes on an existing key (re-issues, since the raw key isn't recoverable).

---

## Wrap-up after this pillar

This is the **last pillar** — the remaining work is not new journeys but two closing passes:

- **Master "nothing dropped" audit.** Walk the full feature list (`docs/Sales software feature list.md` / `feature-list-v2.md`, sections 1–7) against every journey doc and confirm every [P0]–[P3] line landed in exactly one place.
- **Sequencing pass.** Re-order all phase tags into one build sequence now that the full surface area is known, then start building the Spine.
