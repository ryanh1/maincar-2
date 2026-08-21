# SPEC — CRM Data Schema (maincar-2)

**Status:** proposal, not approved. No code written yet.
**Objectives source:** `../../../maincar/docs/journeys/` doc family 4 (4, 4a–4g) + `5a`.
**Benchmarks studied:** Salesforce, HubSpot, Attio (sources at the bottom).

---

## 1. The essential CRM objects

An object earns a place here only if the app's own code depends on it. Everything
else is a custom object the user makes at runtime.

| Object | What it is | Why it is essential |
|---|---|---|
| **Person** | One human | The thing we dial. The centre of the product. |
| **Company** | One organisation | Groups people, deals, and the account feed. |
| **Deal** | One possible sale | Pipeline, forecast, and "why am I calling". |
| **Call** | One phone call | Already exists in maincar-2. The core activity. |
| **Task** | One thing to do | Future tense. Follow-ups, callbacks. |
| **Note** | Free text on a record | Rep memory. |
| **List / ListEntry** | A saved working set of records | Replaces Salesforce's Lead object (see §3). |
| **Pipeline / PipelineStage** | Deal stage config | Kanban, forecast weighting. |
| **DealContactRole** | A person's role on one deal | Multi-threading. The single biggest hole in naive CRMs. |
| **ContactPhone / ContactEmail** | One dialable number / address | A dialer must know which numbers are dead. §5.5 |
| **ObjectDef / AttributeDef** | The schema, stored as data | Add a field with no `ALTER TABLE`. |
| **Record / RecordLink** | Rows of user-invented objects | Custom objects. |
| **FieldHistory** | Who changed what, when | Trust and debugging. |

**Later, not now:** Email, Meeting, SmsMessage (real tables, owned by the comms
and SMS specs), DealLineItem, Sequence/Cadence enrolment.

---

## 2. What we deliberately do NOT build

- **No `Lead` object.** See §3 and §5.2.
- **No Campaign / CampaignMember.** A `source` field on Person and Company covers it.
- **No Product / Pricebook / Quote / OpportunityLineItem.** One `amount` on Deal is enough.
- **No Case / Ticket.** We are not a support desk.
- **No universal association table for the core spine.** See §5.4.

---

## 3. How Salesforce, HubSpot and Attio model these

### Salesforce — models the enterprise *process*

- **Objects:** `Lead`, `Account`, `Contact`, `Opportunity`, `Case`, `Task`/`Event`,
  `Campaign`/`CampaignMember`, `Product2`/`Pricebook2`/`OpportunityLineItem`, `Quote`.
- **`Lead` is a separate object** that flattens person + company onto one row before
  qualification, then *converts* into an Account + Contact + Opportunity. It is a 1999
  marketing-to-sales handoff, frozen into the schema. It duplicates data, the conversion
  is lossy, and every report has to span two different shapes.
- **Relations are typed foreign keys** — `Contact.AccountId`, `Opportunity.AccountId` —
  plus **named junction objects** wherever the edge itself carries data:
  - `OpportunityContactRole` — `ContactId`, `OpportunityId`, `Role`, `IsPrimary`.
  - `AccountContactRelation` — one contact at several accounts.
  - `CampaignMember` — a person's status in a campaign.
- **Activities are polymorphic.** `Task` and `Event` carry `WhoId` (a Lead or Contact)
  and `WhatId` (almost anything else). Two pointer columns, no type safety.
- **Storage is metadata-driven.** Every tenant's rows sit in shared tables (`MT_data`)
  with generic "flex" columns (`Value0…ValueN`) of one universal string type. A Universal
  Data Dictionary maps each virtual field to a physical column, and pivot tables
  (`MT_indexes`) carry typed, indexed copies (`StringValue`, `NumValue`, `DateValue`).
  So adding a custom field inserts a metadata row — it never alters a table.
- **Trade:** unlimited configurability and enormous scale, paid for with a query layer
  nobody outside Salesforce can reproduce, and 25 years of object bloat on top.

### HubSpot — models the *graph*

- **Objects:** contacts, companies, deals, tickets; then **engagements as first-class
  objects** (calls, emails, meetings, notes, tasks, communications); then commerce
  objects; then `leads`, added in 2023.
- **Their `Leads` object is not Salesforce's.** It is a lightweight, repeatable
  *prospecting attempt* that sits on top of an existing contact. One person can have
  several attempts over time. No destructive conversion.
- **Fields are "properties"** on the object. Every record gets an `hs_object_id`, and
  some objects carry a natural unique key too — a contact's email, a company's domain.
- **Every relation is an "association".** There are no foreign-key fields. An association
  is a uniform many-to-many edge between any two object types. Edges can carry a
  **label** ("Decision Maker", "Employee"), which is HubSpot's rebuild of Salesforce's
  `OpportunityContactRole`. Association **limits** are configuration, set per object pair
  and per label, up to 10,000.
- **Trade:** one uniform, endlessly extensible relation model. But cardinality is a
  policy setting rather than a database constraint, and you can never just read a
  `company_id` off a contact — every relation is a join through the association store.

### Attio — models the *typed spreadsheet*

- **Only two objects ship enabled: `people` and `companies`.** `deals`, `users` and
  `workspaces` are standard objects you *turn on*. Everything else is custom.
- **Attributes are semantically typed**, not just structurally. 17 types:
  actor-reference, checkbox, currency, date, domain, email-address, interaction,
  location, personal-name, number, phone-number, rating, record-reference, select,
  status, text, timestamp. Typing the *meaning* is what lets Attio dedupe on domain,
  enrich from a name, and render a phone correctly everywhere.
- **Multiplicity is a property of the field:** `is_multiselect` says whether more than
  one value can be written. No separate join table for "several emails".
- **Value history is the value model, not an audit log.** Every attribute value has
  `active_from` and `active_until`. Writing a new value closes the old one instead of
  overwriting it. Most endpoints return only active values; historical values stay
  queryable.
- **Every object has three system attributes:** `record_id`, `created_at`, `created_by`
  (an actor reference).
- **Process lives in Lists, not in extra objects.** A record can be an **entry** on many
  lists, and the entry carries its own **list attributes** — stage, owner, score — that
  belong to that process and not to the record. This is how Attio has no Lead object and
  does not need one.
- **Trade:** a very small core that stays comprehensible, and rich types that make the UI
  good for free. Less prescriptive out of the box; the customer designs the process.

### The difference in one line each

| | Core objects | Relations | Where process lives | Storage |
|---|---|---|---|---|
| **Salesforce** | many (30+ in Sales Cloud) | typed FKs + named junction objects | in objects (Lead → convert) | shared flex-column tables + metadata dictionary |
| **HubSpot** | few, plus engagements | one universal labeled edge table | in lifecycle-stage properties + the Leads object | properties per object |
| **Attio** | two enabled, three optional | typed record-reference attributes | in Lists and list attributes | typed attributes with value history |

The real split: **Salesforce encodes the process in objects, HubSpot encodes it in edges,
Attio encodes it in lists.** Attio is the benchmark doc family 4 already chose, and it is
the right one for us — but Attio has no telephony, so we add the parts a dialer needs.

---

## 4. Recommendation in one paragraph

Ship a **small typed core** (Person, Company, Deal, Call, Task, Note) as **real Postgres
tables with real foreign keys**, give each of those tables a **`customJson` column** for
user-added fields described by `AttributeDef` rows, and keep the generic
`Record` table for whole objects the user invents. Copy **Attio's attribute types** and
**Lists/entries**. Copy **Salesforce's `OpportunityContactRole`** as `DealContactRole`.
Copy **HubSpot's natural unique keys** (company domain, contact email). Skip
**Salesforce's `Lead`** and **HubSpot's universal association table**.

---

## 5. The decisions, with reasons

### 5.1 Storage — typed core + `customJson`, not a full dynamic model

Doc 4 in maincar v1 decided on **two storage models**: dynamic objects (People,
Companies, Deals, Tasks) as `Record` rows with a `valuesJson` column, and table-backed
objects (Calls, Emails, Texts) as real tables. The reasoning there is sound and the
rejection of EAV and of live `ALTER TABLE` is correct.

**Where this proposal differs:** put People, Companies and Deals in **real tables too**,
and give every core table a `customJson` JSONB column for user-added fields.

Why:

1. **The dialer needs real foreign keys.** `Call.personId → Person.id` with
   `onDelete: Restrict` is enforced by Postgres. If Person is a `Record` row, that
   relation becomes a string in a JSON blob that nothing checks.
2. **Uniqueness must be real.** `@@unique([orgId, domain])` on Company is one line.
   Under JSONB it is a partial expression index plus application code plus a race
   condition.
3. **The app depends on these fields anyway.** `attentionStatus`, `callbackDate`,
   `ownerUserId` and `stageId` are read by workflows, the dialer, and reporting. They
   are not user-shaped data. Doc 4 already calls them `isSystem` fields that can never
   be deleted or retyped — which is the definition of a column.
4. **Salesforce proves pure metadata storage works, and also proves the cost.** It works
   because they built a query planner, a pivot-index layer and a data dictionary around
   it. We would be hand-rolling all three in application code while also building a
   phone system.

What we keep from the dynamic model: **`ObjectDef` + `AttributeDef` still describe every
object, including the table-backed ones.** The UI, the field editor, validation, field
history and views all read `AttributeDef` and never care where the value physically
sits. `ObjectDef.storage` is `"table"` or `"record"`, and one adapter resolves it.
Adding a custom field is still an insert, never a migration.

**Cost of this choice, stated honestly:** adding a *standard* field later is a real
migration. That is acceptable — we control those, and there are maybe 40 of them.

### 5.2 No Lead object

A Person plus `attentionStatus` plus **list membership** covers it. Attio has no Lead.
HubSpot's modern Leads object is a repeatable attempt on top of a contact, not a
pre-contact duplicate. Salesforce's Lead is the one we would regret.

If we later need several concurrent prospecting cycles on one person, model it as a
**ListEntry** or a sequence enrolment — a row per attempt — not as a second person-shaped
object.

### 5.3 Lists carry their own fields

Straight from Attio. `List` holds records of one object; `ListEntry` links a record into
a list **and carries entry-only values** in `valuesJson`. That is where "stage in this
campaign", "call attempt count", and "priority for this blitz" live, without polluting
the Person record for everyone else.

### 5.4 Relations: typed FKs for the spine, named joins where the edge means something

- **Spine, as real columns:** `Person.companyId`, `Deal.companyId`,
  `Company.parentCompanyId`, `Call.personId`.
- **Edge with data, as a named join model:** `DealContactRole` (person + deal + role +
  isPrimary). This is Salesforce's `OpportunityContactRole` and HubSpot's association
  labels, done as a table with columns.
- **One generic `RecordLink` table** only for references involving custom objects, and
  for note/task links to anything.

Rejecting HubSpot's universal association table is deliberate: our spine is fixed and a
dialer screen must load a person, their company, their deals and their last five calls in
one round trip. Indexed foreign keys do that. A generic edge store does not, without
work we would rather spend elsewhere.

### 5.5 Phones and emails are rows, not columns — with a status

This is the part no generic CRM gets right and where a dialer earns its money.

`ContactPhone` carries `e164`, `label`, **`status`** (`unverified` | `valid` | `dead` |
`wrong_number` | `dnc`), **`source`** (who or what put it there), `isPrimary`,
`lastVerifiedAt`, `lastCalledAt`. `ContactEmail` mirrors it.

Attio's `phone-number` type gives one well-formatted value. We dial ours, so each value
needs its own life story. Doc family 4 calls this the "universal dead value" pattern.

### 5.6 Attribute types: copy Attio's list

`text, number, checkbox, date, timestamp, phone, email, url, domain, select,
multiselect, status, currency, rating, location, person_name, record_reference,
actor_reference`.

Type the meaning, not the storage. `AttributeDef.type` + `optionsJson` covers all of it.

### 5.7 Field history: a table, written in the same transaction

Doc 4 is right and Attio's `active_from`/`active_until` is the wrong shape for us. A
separate `FieldHistory` row keeps "what is the current value" a plain column read, which
is 99% of queries. Write it **inside the same transaction** as the change, so a change and
its history can never disagree. Store a compact `{old, new}` JSON, not a snapshot.

### 5.8 Money is integer minor units

`amountMinor BigInt` + `currency String` (ISO 4217). Never a float.

### 5.9 Tenancy is `orgId`, everywhere

v1 says `workspaceId`. maincar-2 says `orgId` and the house rules require it on every
org-scoped model, indexed, filtered on reads and writes. One name for one thing.

### 5.10 Archive first, delete into a 30-day trash

`isArchived` for the safe hide, `deletedAt` for the soft delete, an hourly sweep for the
hard delete. Standard objects can be hidden, never deleted.

---

## 6. Proposed Prisma

House rules applied: no `enum`, `createdAt`/`updatedAt` on every model, `orgId` on every
org-scoped model and indexed.

```prisma
// ---------------------------------------------------------------------------
// Core CRM — typed tables. Standard fields are columns; user-added fields live
// in customJson and are described by AttributeDef rows.
// ---------------------------------------------------------------------------

model Person {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  legalName     String
  preferredName String?   // display name = preferredName ?? legalName
  title         String?
  linkedinUrl   String?

  companyId String?
  company   Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)

  ownerUserId String?
  owner       User?   @relation("PersonOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)

  timeZone String?   // IANA, for "is it a decent hour to call"

  // decision_maker | gatekeeper | champion | influencer | user | other
  persona String?

  // on_deck | on_hold | backburner | disqualified
  attentionStatus String  @default("on_deck")
  attentionReason String?
  callbackDate    DateTime?

  source          String?   // manual | import | enrichment | inbound_call | ...
  lastContactedAt DateTime?

  customJson Json @default("{}")

  isArchived Boolean   @default(false)
  deletedAt  DateTime?

  phones    ContactPhone[]
  emails    ContactEmail[]
  dealRoles DealContactRole[]
  calls     Call[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId])
  @@index([orgId, companyId])
  @@index([orgId, ownerUserId])
  @@index([orgId, attentionStatus])
  @@index([orgId, callbackDate])
}

model Company {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  dba       String?  // the name they go by; display name = dba ?? legalName
  legalName String

  domain           String?
  alternateDomains String[] @default([])

  industry      String?
  sizeEmployees Int?

  parentCompanyId String?
  parentCompany   Company?  @relation("CompanyParent", fields: [parentCompanyId], references: [id], onDelete: SetNull)
  subsidiaries    Company[] @relation("CompanyParent")

  ownerUserId String?
  owner       User?   @relation("CompanyOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)

  attentionStatus String    @default("on_deck")
  attentionReason String?
  callbackDate    DateTime?
  source          String?

  customJson Json @default("{}")

  isArchived Boolean   @default(false)
  deletedAt  DateTime?

  people Person[]
  deals  Deal[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, domain])   // HubSpot's natural key. NULLs do not collide.
  @@index([orgId])
  @@index([orgId, parentCompanyId])
  @@index([orgId, ownerUserId])
}

model Deal {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  name String

  companyId String?
  company   Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)

  pipelineId String
  pipeline   Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Restrict)

  stageId String
  stage   PipelineStage @relation(fields: [stageId], references: [id], onDelete: Restrict)

  amountMinor BigInt? // integer minor units, never a float
  currency    String  @default("USD")

  closeDate DateTime?

  status     String  @default("open") // open | won | lost
  lostReason String?

  ownerUserId String?
  owner       User?   @relation("DealOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)

  customJson Json @default("{}")

  isArchived Boolean   @default(false)
  deletedAt  DateTime?

  contactRoles DealContactRole[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId])
  @@index([orgId, companyId])
  @@index([orgId, stageId])
  @@index([orgId, ownerUserId])
  @@index([orgId, closeDate])
}

// Salesforce's OpportunityContactRole. The buying committee.
model DealContactRole {
  id    String @id @default(cuid())
  orgId String

  dealId   String
  deal     Deal   @relation(fields: [dealId], references: [id], onDelete: Cascade)
  personId String
  person   Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  // champion | decision_maker | economic_buyer | influencer | blocker | user | other
  role      String
  isPrimary Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([dealId, personId])
  @@index([orgId])
  @@index([personId])
}

model Pipeline {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  name      String
  isDefault Boolean @default(false)

  stages PipelineStage[]
  deals  Deal[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId])
}

model PipelineStage {
  id    String @id @default(cuid())
  orgId String

  pipelineId String
  pipeline   Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)

  name           String
  color          String @default("#94a3b8")
  sortOrder      Int
  winProbability Int    @default(0) // 0..100, weights the forecast

  // open | won | lost — lets the board know which columns end the deal
  outcome String @default("open")

  deals Deal[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId])
  @@index([pipelineId, sortOrder])
}

// ---------------------------------------------------------------------------
// Dialable identity — one row per value, each with its own status
// ---------------------------------------------------------------------------

model ContactPhone {
  id    String @id @default(cuid())
  orgId String

  personId String
  person   Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  e164      String
  extension String?
  label     String  @default("other") // mobile | direct | work | main | home | other

  // unverified | valid | dead | wrong_number | dnc
  status String @default("unverified")

  source    String? // manual | import | enrichment | inbound_call | ai_call
  isPrimary Boolean @default(false)

  lastVerifiedAt DateTime?
  lastCalledAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([personId, e164])
  @@index([orgId])
  @@index([orgId, e164])
  @@index([orgId, status])
}

model ContactEmail {
  id    String @id @default(cuid())
  orgId String

  personId String
  person   Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  address String
  label   String @default("work") // work | personal | other

  // unverified | valid | dead | bounced | unsubscribed
  status String @default("unverified")

  source    String?
  isPrimary Boolean @default(false)

  lastVerifiedAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([personId, address])
  @@index([orgId])
  @@index([orgId, address])
}

// ---------------------------------------------------------------------------
// Work — tasks and notes
// ---------------------------------------------------------------------------

model Task {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  title String
  body  String?

  type       String @default("todo") // call | email | todo
  priority   String @default("med")  // low | med | high
  commitment String @default("soft") // hard (appointment) | soft (reminder)

  assigneeUserId String?
  assignee       User?   @relation("TaskAssignee", fields: [assigneeUserId], references: [id], onDelete: SetNull)

  dueAt    DateTime?
  remindAt DateTime?

  isDone Boolean   @default(false)
  doneAt DateTime?

  deletedAt DateTime?

  links RecordLink[] @relation("TaskLinks")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId])
  @@index([orgId, assigneeUserId, isDone])
  @@index([orgId, dueAt])
}

model Note {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  bodyJson Json // TipTap document
  bodyText String // flattened, for full-text search

  authorUserId String?
  author       User?   @relation("NoteAuthor", fields: [authorUserId], references: [id], onDelete: SetNull)

  deletedAt DateTime?

  links RecordLink[] @relation("NoteLinks")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId])
}

// ---------------------------------------------------------------------------
// Lists — Attio's model. Process lives here, not in extra objects.
// ---------------------------------------------------------------------------

model List {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  name       String
  slug       String
  objectSlug String // which object this list holds: person | company | deal | <custom>

  ownerUserId String?

  isArchived Boolean   @default(false)
  deletedAt  DateTime?

  entries ListEntry[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, slug])
  @@index([orgId])
}

model ListEntry {
  id    String @id @default(cuid())
  orgId String

  listId String
  list   List   @relation(fields: [listId], references: [id], onDelete: Cascade)

  // The record this entry points at. objectSlug matches List.objectSlug.
  objectSlug String
  targetId   String

  // Entry-only values — stage in THIS process, attempt count, blitz priority.
  // Described by AttributeDef rows whose scope is "list".
  valuesJson Json @default("{}")

  position      Int?
  addedByUserId String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([listId, objectSlug, targetId])
  @@index([orgId])
  @@index([objectSlug, targetId])
}

// ---------------------------------------------------------------------------
// Schema-as-data — describes BOTH the typed tables and the generic records
// ---------------------------------------------------------------------------

model ObjectDef {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  slug String // person | company | deal | call | task | note | <custom>
  name String
  icon String?

  // "table"  = a real Postgres table; standard columns + customJson.
  // "record" = a Record row with valuesJson. Custom objects only.
  storage String @default("record")

  isStandard   Boolean @default(false) // app-seeded and app-depended-on
  isFirstClass Boolean @default(true)  // gets a navbar link and a table

  isHidden   Boolean   @default(false)
  isArchived Boolean   @default(false)
  deletedAt  DateTime? // blocked when isStandard

  attributes AttributeDef[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, slug])
  @@index([orgId])
}

model AttributeDef {
  id    String @id @default(cuid())
  orgId String

  objectId String
  object   ObjectDef @relation(fields: [objectId], references: [id], onDelete: Cascade)

  slug String
  name String
  icon String?

  // text | number | checkbox | date | timestamp | phone | email | url | domain
  // | select | multiselect | status | currency | rating | location
  // | person_name | record_reference | actor_reference
  type String

  optionsJson Json?   // select options with colour + order; currency code; rating scale
  refObjectId String? // for record_reference

  // "column" = lives in a real column on the table (isSystem is always true here)
  // "custom" = lives in customJson / valuesJson
  // "list"   = lives in ListEntry.valuesJson
  storage String @default("custom")

  isMulti    Boolean @default(false)
  isRequired Boolean @default(false)
  isUnique   Boolean @default(false)
  isReadOnly Boolean @default(false)
  isSystem   Boolean @default(false) // rename/hide OK; delete and retype blocked

  defaultJson Json?
  sortOrder   Int   @default(0)

  isArchived Boolean   @default(false)
  deletedAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([objectId, slug])
  @@index([orgId])
}

model Record {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  objectId String

  valuesJson Json @default("{}") // { attributeSlug: value }. Empty = key absent, never "".

  isArchived Boolean   @default(false)
  deletedAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId, objectId])
  // plus a GIN index on valuesJson, added in the migration by hand
}

// A reference that crosses into a custom object, or a note/task link to anything.
// The core spine does NOT use this — it uses real foreign keys.
model RecordLink {
  id    String @id @default(cuid())
  orgId String

  fromObject String  // person | company | deal | note | task | <custom>
  fromId     String
  attribute  String? // the AttributeDef slug, when this link is a reference field

  toObject String
  toId     String

  noteId String?
  note   Note?   @relation("NoteLinks", fields: [noteId], references: [id], onDelete: Cascade)
  taskId String?
  task   Task?   @relation("TaskLinks", fields: [taskId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId, fromObject, fromId])
  @@index([orgId, toObject, toId])
}

model FieldHistory {
  id    String @id @default(cuid())
  orgId String

  objectSlug String
  recordId   String
  attribute  String

  oldJson Json?
  newJson Json?

  changedByUserId String?
  changedAt       DateTime @default(now())

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orgId, objectSlug, recordId, changedAt])
}
```

### Changes to the existing `Call` model

`Call` today stores only `fromE164` / `toE164`. Add the CRM spine, all nullable so an
unknown number still logs a call:

```prisma
  personId  String?
  person    Person?  @relation(fields: [personId], references: [id], onDelete: SetNull)
  companyId String?
  company   Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)
  dealId    String?
  deal      Deal?    @relation(fields: [dealId], references: [id], onDelete: SetNull)

  @@index([orgId, personId, createdAt])
  @@index([orgId, companyId, createdAt])
```

A number-to-person match runs on `ContactPhone.e164` at call time.

---

## 7. The one decision that needs Ryan

**Storage for People / Companies / Deals.**

- **A — Typed tables + `customJson`** (this proposal). Real FKs and real unique
  constraints from day one. Adding a *standard* field later needs a migration.
- **B — Generic `Record` + `valuesJson`** (maincar v1 doc 4). Zero migrations ever. All
  integrity, uniqueness and join logic moves into application code.

Recommendation: **A.** We are building a dialer first, and the dialer's hot path is
"who is this number, what company, what deals, what were the last five calls". Option A
makes that four indexed joins. Option B makes it four hand-written JSON queries with no
database guarantee that any of the ids point at anything real.

---

## 8. Sources

- Attio — [data model overview](https://attio.com/help/reference/attio-101/attios-data-model/understanding-attio-data-model) · [objects and lists](https://docs.attio.com/docs/objects-and-lists) · [standard objects](https://docs.attio.com/docs/standard-objects) · [attribute types](https://docs.attio.com/rest-api/attribute-types/attribute-types)
- HubSpot — [understanding the CRM](https://developers.hubspot.com/docs/guides/api/crm/understanding-the-crm) · [associate records](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associate-records/guide) · [association limits](https://knowledge.hubspot.com/object-settings/set-limits-for-record-associations)
- Salesforce — [OpportunityContactRole](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunitycontactrole.htm) · [object reference](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm) · [platform multitenant architecture](https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-multitenant-architecture.html)
- maincar v1 — `docs/journeys/4-crm-data-and-views.md` (doc family 4)
