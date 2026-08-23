# Maincar schema

> AUTO-GENERATED — DO NOT EDIT BY HAND.
> Generated at: 2026-08-23T00:54:22.022Z
> Dynamic-object source: seeded standard-object definitions.
> Journey: [4.S4 — Generate a Prisma-style schema markdown](../journeys/4-crm-data-and-views.md#journey-4s4--generate-a-prisma-style-schema-markdown-for-every-object-internal-engineering-tool).

## Dynamic objects (schema-as-data)

### Company

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `company` · Display: Companies (Company).

```prisma
model Company {
  name             String? // column; system
  legalName        String? // column; system
  domain           String? // column; system; unique
  companyType      String? // enum: saas | agency | manufacturer | retailer | services | non_profit | other; column; system
  industry         String? // column; system
  sizeEmployees    Float? // column; system
  linkedinUrl      String? // column; system
  logoUrl          String? // column; system
  parentCompanyId  String? // → Company; column; system
  ownerUserId      String? // → User; column; system
  attentionStatus  String // enum: on_deck | on_hold | backburner | disqualified; column; system; required
  attentionReason  String? // enum: other_stakeholder | cooled | timing | bad_fit | other; column; system
  callbackDate     DateTime? // column; system
  source           String? // enum: manual | import | enrichment | inbound_call | referral | other; column; system
}
```

### Person

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `person` · Display: People (Person).

```prisma
model Person {
  firstName        String? // column; system
  lastName         String? // column; system
  preferredFirstName String? // column; system
  title            String? // column; system
  linkedinUrl      String? // column; system
  companyId        String? // → Company; column; system
  ownerUserId      String? // → User; column; system
  persona          String? // enum: decision_maker | gatekeeper | champion | influencer | user | other; column; system
  attentionStatus  String // enum: on_deck | on_hold | backburner | disqualified; column; system; required
  attentionReason  String? // enum: other_stakeholder | cooled | timing | bad_fit | other; column; system
  callbackDate     DateTime? // column; system
  timeZone         String? // column; system
  source           String? // enum: manual | import | enrichment | inbound_call | referral | other; column; system
  lastContactedAt  DateTime? // column; system
  x_url            String? // JSON
  website_url      String? // JSON
  github_url       String? // JSON
}
```

### Deal

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `deal` · Display: Deals (Deal).

```prisma
model Deal {
  name             String // column; system; required
  companyId        String? // → Company; column; system
  amountMinor      Decimal? // column; system
  stageId          String // column; system; required
  status           String? // enum: open | won | lost; column; system
  closeDate        DateTime? // column; system
  lostReason       String? // enum: price | timing | competitor | no_budget | no_decision | other; column; system
  ownerUserId      String? // → User; column; system
  segment          String? // enum: Enterprise | Mid-market | SMB; JSON; system
}
```

### Call

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `call` · Display: Calls (Call).

```prisma
model Call {
  direction        String? // enum: inbound | outbound; column; system
  fromE164         String? // column; system
  toE164           String? // column; system
  status           String? // column; system
}
```

### Email

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `email` · Display: Emails (Email).

```prisma
model Email {

}
```

### Text

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `sms` · Display: Texts (Text).

```prisma
model Text {

}
```

### Meeting

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `meeting` · Display: Meetings (Meeting).

```prisma
model Meeting {

}
```

### Task

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `task` · Display: Tasks (Task).

```prisma
model Task {

}
```

### Note

Storage kind: **schema-as-data table definition + customJson**.
Seed/object slug: `note` · Display: Notes (Note).

```prisma
model Note {

}
```

## Real Prisma tables

### Org

Storage kind: **real Prisma table**.

```prisma
model Org {
  id                       String // id; default: "cuid()"
  name                     String?
  logo                     String?
  avatarKey                String?
  enabled                  Boolean // default: "true"
  recordCalls              Boolean // default: "true"
  blockTwoPartyConsentStates Boolean // default: "true"
  recordingAllowedStates   String[] // default: "[]"
  recordingBlockedStates   String[] // default: "[\"CA\", \"CT\", \"DE\", \"FL\", \"IL\", \"MD\", \"MA\", \"MI\", \"MT\", \"NV\", \"NH\", \"OR\", \"PA\", \"WA\", \"UNKNOWN\"]"
  seedVersion              Int // default: "0"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
  memberships              Membership[]
  invitations              Invitation[]
  phoneNumbers             PhoneNumber[]
  calls                    Call[]
  dispositions             DispositionDef[]
  transcripts              Transcript[]
  transcriptSegments       TranscriptSegment[]
  callSpeakers             CallSpeaker[]
  callComments             CallComment[]
  callCommentReactions     CallCommentReaction[]
  emailDrafts              EmailDraft[]
  emailTemplates           EmailTemplate[]
  oauthConnections         OAuthConnection[]
  mailAccounts             MailAccount[]
  companies                Company[]
  people                   Person[]
  personPhones             PersonPhone[]
  personEmails             PersonEmail[]
  pipelines                Pipeline[]
  pipelineStages           PipelineStage[]
  deals                    Deal[]
  dealPersonRoles          DealPersonRole[]
  objectDefs               ObjectDef[]
  attributeDefs            AttributeDef[]
  savedViews               SavedView[]
  detailLayouts            DetailLayout[]
  records                  Record[]
  recordLinks              RecordLink[]
  fieldHistory             FieldHistory[]
  provenance               Provenance[]
  emails                   Email[]
  emailParticipants        EmailParticipant[]
  emailAttachments         EmailAttachment[]
  smsMessages              SmsMessage[]
  messageMedia             MessageMedia[]
  meetings                 Meeting[]
  meetingAttendees         MeetingAttendee[]
  activityEntries          ActivityEntry[]
  tasks                    Task[]
  notes                    Note[]
  lists                    List[]
  listEntries              ListEntry[]
  reports                  Report[]
  analyticsRollups         AnalyticsRollup[]
  notificationObjects      NotificationObject[]
  notifications            Notification[]
  teams                    Team[]
  teamMembers              TeamMember[]
  voicemails               Voicemail[]
  voicemailGreetings       VoicemailGreeting[]
  voicemailDrops           VoicemailDrop[]
}
```

### User

Storage kind: **real Prisma table**.

```prisma
model User {
  id                       String // id; default: "cuid()"
  firebaseUid              String
  email                    String
  firstName                String?
  lastName                 String?
  title                    String?
  imageUrl                 String?
  avatarKey                String?
  enabled                  Boolean // default: "true"
  roles                    String[] // default: "[\"basic\"]"
  timeZone                 String?
  currentOrgId             String?
  memberships              Membership[]
  teamsLed                 Team[] // relation: TeamLead
  teamMemberships          TeamMember[]
  invitationsSent          Invitation[] // relation: InvitationSender
  invitationsAccepted      Invitation[] // relation: InvitationAcceptor
  phoneNumbers             PhoneNumber[]
  calls                    Call[]
  callCommentsAuthored     CallComment[] // relation: CallCommentAuthor
  callCommentReactions     CallCommentReaction[]
  emailDrafts              EmailDraft[]
  emailTemplates           EmailTemplate[]
  emailSignatures          EmailSignature[]
  oauthConnections         OAuthConnection[]
  mailAccounts             MailAccount[]
  reportsOwned             Report[] // relation: ReportOwner
  reportsDeleted           Report[] // relation: ReportDeletedBy
  smsMessages              SmsMessage[] // relation: SmsMailbox
  activityEntries          ActivityEntry[]
  tasksAssigned            Task[] // relation: TaskAssignee
  notesAuthored            Note[] // relation: NoteAuthor
  notificationObjectsAuthored NotificationObject[] // relation: NotificationActor
  notificationsReceived    Notification[] // relation: NotificationRecipient
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Membership

Storage kind: **real Prisma table**.

```prisma
model Membership {
  id                       String // id; default: "cuid()"
  userId                   String
  orgId                    String
  user                     User
  org                      Org
  roles                    String[] // default: "[\"basic\"]"
  isActive                 Boolean // default: "true"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Team

Storage kind: **real Prisma table**.

```prisma
model Team {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  name                     String
  leadUserId               String
  lead                     User // relation: TeamLead
  archivedAt               DateTime?
  members                  TeamMember[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### TeamMember

Storage kind: **real Prisma table**.

```prisma
model TeamMember {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  teamId                   String
  team                     Team
  userId                   String
  user                     User
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Invitation

Storage kind: **real Prisma table**.

```prisma
model Invitation {
  id                       String // id; default: "cuid()"
  token                    String
  email                    String
  orgId                    String
  org                      Org
  status                   String // default: "\"PENDING\""
  roles                    String[] // default: "[\"basic\"]"
  expiresAt                DateTime
  acceptedAt               DateTime?
  acceptedByUserId         String?
  acceptedByUser           User? // relation: InvitationAcceptor
  invitedByUserId          String?
  invitedByUser            User? // relation: InvitationSender
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### PhoneNumber

Storage kind: **real Prisma table**.

```prisma
model PhoneNumber {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  assignedUserId           String?
  assignedUser             User?
  e164                     String
  twilioSid                String?
  status                   String // default: "\"searching\""
  isActiveForOutbound      Boolean // default: "false"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Call

Storage kind: **real Prisma table**.

```prisma
model Call {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  userId                   String
  user                     User
  fromE164                 String
  toE164                   String
  direction                String
  status                   String // default: "\"queued\""
  twilioCallSid            String?
  recordingConsent         String?
  recordingPlanned         Boolean?
  recordingReason          String?
  destinationState         String?
  recordingEnabled         Boolean?
  recordingUrl             String?
  recordingStatus          String // default: "\"pending\""
  transcriptStatus         String // default: "\"pending\""
  transcript               String?
  dispositionId            String?
  disposition              DispositionDef?
  noteText                 String?
  finalTranscript          Transcript?
  speakers                 CallSpeaker[]
  comments                 CallComment[]
  durationS                Int?
  startedAt                DateTime?
  endedAt                  DateTime?
  personId                 String?
  person                   Person?
  companyId                String?
  company                  Company?
  dealId                   String?
  deal                     Deal?
  customJson               Json // default: "\"{}\""
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### DispositionDef

Storage kind: **real Prisma table**.

```prisma
model DispositionDef {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  value                    String
  label                    String
  color                    String // default: "\"option-1\""
  icon                     String?
  category                 String // default: "\"not_connected\""
  isStandard               Boolean // default: "false"
  isPinned                 Boolean // default: "false"
  pinOrder                 Int?
  sortOrder                Int // default: "0"
  isArchived               Boolean // default: "false"
  calls                    Call[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Transcript

Storage kind: **real Prisma table**.

```prisma
model Transcript {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  callId                   String
  call                     Call
  provider                 String
  plainText                String
  segments                 TranscriptSegment[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### TranscriptSegment

Storage kind: **real Prisma table**.

```prisma
model TranscriptSegment {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  transcriptId             String
  transcript               Transcript
  position                 Int
  speakerKey               String
  startMs                  Int
  endMs                    Int
  text                     String
  words                    Json
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### CallSpeaker

Storage kind: **real Prisma table**.

```prisma
model CallSpeaker {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  callId                   String
  call                     Call
  speakerKey               String
  displayName              String?
  source                   String
  evidence                 Json?
  confidence               Float?
  personId                 String?
  person                   Person?
  confirmedAt              DateTime?
  manualOverride           Boolean // default: "false"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### CallComment

Storage kind: **real Prisma table**.

```prisma
model CallComment {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  callId                   String
  call                     Call
  parentId                 String?
  parent                   CallComment? // relation: CallCommentReplies
  replies                  CallComment[] // relation: CallCommentReplies
  authorUserId             String?
  author                   User? // relation: CallCommentAuthor
  bodyJson                 Json
  bodyText                 String
  atMs                     Int?
  anchorEndMs              Int?
  anchorQuote              String?
  selectionStartChar       Int?
  selectionEndChar         Int?
  transcriptId             String?
  deletedAt                DateTime?
  reactions                CallCommentReaction[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### CallCommentReaction

Storage kind: **real Prisma table**.

```prisma
model CallCommentReaction {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  commentId                String
  comment                  CallComment
  userId                   String
  user                     User
  emoji                    String
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### VoicemailGreeting

Storage kind: **real Prisma table**.

```prisma
model VoicemailGreeting {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  sourceKey                String?
  storageKey               String?
  status                   String // default: "\"uploading\""
  idempotencyKey           String
  contentHash              String
  durationSeconds          Int?
  failureReason            String?
  uploadedAt               DateTime?
  deletedAt                DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### VoicemailDrop

Storage kind: **real Prisma table**.

```prisma
model VoicemailDrop {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  name                     String
  audioUrl                 String
  duration                 Int
  isDefault                Boolean // default: "false"
  transcriptStatus         String // default: "\"pending\""
  transcript               String?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Voicemail

Storage kind: **real Prisma table**.

```prisma
model Voicemail {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  callSid                  String
  fromE164                 String
  toE164                   String
  greeting                 String?
  recordingUrl             String?
  transcriptStatus         String // default: "\"pending\""
  transcript               String?
  durationS                Int?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### EmailDraft

Storage kind: **real Prisma table**.

```prisma
model EmailDraft {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  userId                   String
  user                     User
  mailAccountId            String?
  mailAccount              MailAccount?
  recordObject             String?
  recordId                 String?
  toAddrs                  String[]
  ccAddrs                  String[]
  bccAddrs                 String[]
  subject                  String?
  bodyHtml                 String?
  isOpen                   Boolean // default: "true"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### EmailSignature

Storage kind: **real Prisma table**.

```prisma
model EmailSignature {
  id                       String // id; default: "cuid()"
  userId                   String
  user                     User
  name                     String
  bodyHtml                 String
  isDefault                Boolean // default: "false"
  defaultForUser           String?
  isDefaultForNew          Boolean // default: "false"
  defaultForNewUser        String?
  isDefaultForReply        Boolean // default: "false"
  defaultForReplyUser      String?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### EmailTemplate

Storage kind: **real Prisma table**.

```prisma
model EmailTemplate {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  createdById              String?
  createdBy                User?
  name                     String
  subject                  String
  bodyHtml                 String
  visibility               EmailTemplateVisibility // default: "PRIVATE"
  fieldsJson               Json?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### OAuthConnection

Storage kind: **real Prisma table**.

```prisma
model OAuthConnection {
  id                       String // id; default: "cuid()"
  org                      Org
  orgId                    String
  user                     User
  userId                   String
  provider                 String
  providerAccountId        String
  emailAddress             String
  refreshToken             String
  accessToken              String?
  expiresAt                DateTime?
  scopes                   String[] // default: "[]"
  status                   String // default: "\"connected\""
  errorCode                String?
  statusDetail             String?
  lastValidatedAt          DateTime?
  lastRefreshAt            DateTime?
  mailAccount              MailAccount?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### MailAccount

Storage kind: **real Prisma table**.

```prisma
model MailAccount {
  id                       String // id; default: "cuid()"
  org                      Org
  orgId                    String
  user                     User
  userId                   String
  connection               OAuthConnection
  connectionId             String
  provider                 String
  emailAddress             String
  displayName              String?
  isPrimary                Boolean // default: "false"
  emails                   Email[]
  emailDrafts              EmailDraft[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Company

Storage kind: **real Prisma table**.

```prisma
model Company {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  name                     String?
  legalName                String?
  companyType              String?
  domain                   String?
  alternateDomains         String[] // default: "[]"
  linkedinUrl              String?
  industry                 String?
  sizeEmployees            Int?
  logoUrl                  String?
  mergedIntoId             String?
  deletedById              String?
  parentCompanyId          String?
  parentCompany            Company? // relation: CompanyParent
  childCompanies           Company[] // relation: CompanyParent
  ownerUserId              String?
  attentionStatus          String // default: "\"on_deck\""
  attentionReason          String?
  callbackDate             DateTime?
  source                   String?
  customJson               Json // default: "\"{}\""
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  people                   Person[]
  deals                    Deal[]
  calls                    Call[]
  emails                   Email[]
  smsMessages              SmsMessage[]
  meetings                 Meeting[]
  activity                 ActivityEntry[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Person

Storage kind: **real Prisma table**.

```prisma
model Person {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  firstName                String?
  lastName                 String?
  preferredFirstName       String?
  title                    String?
  linkedinUrl              String?
  companyId                String?
  company                  Company?
  ownerUserId              String?
  timeZone                 String?
  persona                  String?
  attentionStatus          String // default: "\"on_deck\""
  attentionReason          String?
  callbackDate             DateTime?
  source                   String?
  lastContactedAt          DateTime?
  nameAudioUrl             String?
  customJson               Json // default: "\"{}\""
  mergedIntoId             String?
  deletedById              String?
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  phones                   PersonPhone[]
  addresses                PersonEmail[]
  dealRoles                DealPersonRole[]
  calls                    Call[]
  callSpeakers             CallSpeaker[]
  emailParticipations      EmailParticipant[]
  smsMessages              SmsMessage[]
  meetingAttendances       MeetingAttendee[]
  organizedMeetings        Meeting[] // relation: MeetingOrganizer
  activity                 ActivityEntry[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### PersonPhone

Storage kind: **real Prisma table**.

```prisma
model PersonPhone {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  personId                 String
  person                   Person
  e164                     String
  extension                String?
  label                    String // default: "\"other\""
  status                   String // default: "\"unverified\""
  reason                   String?
  isDnc                    Boolean // default: "false"
  dncReason                String?
  lineType                 String?
  lineTypeCheckedAt        DateTime?
  source                   String?
  isPrimary                Boolean // default: "false) // app-enforced: at most one true per person (§5.11"
  timesDialed              Int // default: "0"
  lastDialedAt             DateTime?
  timesConnected           Int // default: "0"
  lastConnectedAt          DateTime?
  bestTimeToCall           String?
  lastVerifiedAt           DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### PersonEmail

Storage kind: **real Prisma table**.

```prisma
model PersonEmail {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  personId                 String
  person                   Person
  address                  String
  label                    String // default: "\"work\""
  status                   String // default: "\"unverified\""
  reason                   String?
  isDnc                    Boolean // default: "false"
  dncReason                String?
  source                   String?
  isPrimary                Boolean // default: "false) // app-enforced: at most one true per person (§5.11"
  lastVerifiedAt           DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Pipeline

Storage kind: **real Prisma table**.

```prisma
model Pipeline {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  name                     String
  isDefault                Boolean // default: "false"
  stages                   PipelineStage[]
  deals                    Deal[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Report

Storage kind: **real Prisma table**.

```prisma
model Report {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  ownerId                  String?
  owner                    User? // relation: ReportOwner
  name                     String
  kind                     String // default: "\"pivot\""
  configJson               Json
  deletedAt                DateTime?
  deletedById              String?
  deletedBy                User? // relation: ReportDeletedBy
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### AnalyticsRollup

Storage kind: **real Prisma table**.

```prisma
model AnalyticsRollup {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  day                      DateTime
  hourOfDay                Int?
  numberE164               String
  areaCode                 String?
  dials                    Int // default: "0"
  connects                 Int // default: "0"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### PipelineStage

Storage kind: **real Prisma table**.

```prisma
model PipelineStage {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  pipelineId               String
  pipeline                 Pipeline
  name                     String
  color                    String // default: "\"#94a3b8\""
  sortOrder                Int
  winProbability           Int // default: "0"
  outcome                  String // default: "\"open\""
  deals                    Deal[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Deal

Storage kind: **real Prisma table**.

```prisma
model Deal {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  name                     String
  companyId                String?
  company                  Company?
  pipelineId               String
  pipeline                 Pipeline
  stageId                  String
  stage                    PipelineStage
  amountMinor              BigInt?
  currency                 String // default: "\"USD\""
  closeDate                DateTime?
  status                   String // default: "\"open\""
  lostReason               String?
  ownerUserId              String?
  customJson               Json // default: "\"{}\""
  mergedIntoId             String?
  deletedById              String?
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  personRoles              DealPersonRole[]
  calls                    Call[]
  emails                   Email[]
  smsMessages              SmsMessage[]
  meetings                 Meeting[]
  activity                 ActivityEntry[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### DealPersonRole

Storage kind: **real Prisma table**.

```prisma
model DealPersonRole {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  dealId                   String
  deal                     Deal
  personId                 String
  person                   Person
  role                     String
  isPrimary                Boolean // default: "false"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### ObjectDef

Storage kind: **real Prisma table**.

```prisma
model ObjectDef {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  slug                     String
  name                     String
  namePlural               String
  icon                     String?
  iconColor                String?
  storage                  String // default: "\"record\""
  isStandard               Boolean // default: "false"
  isFirstClass             Boolean // default: "true"
  timelineEventsEnabled    Boolean // default: "false"
  isHidden                 Boolean // default: "false"
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  attributes               AttributeDef[]
  savedViews               SavedView[]
  detailLayouts            DetailLayout[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### AttributeDef

Storage kind: **real Prisma table**.

```prisma
model AttributeDef {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  objectId                 String
  object                   ObjectDef
  slug                     String
  name                     String
  description              String?
  icon                     String?
  type                     String
  optionsJson              Json?
  refObjectId              String?
  formatJson               Json?
  validationJson           Json?
  isIdentity               Boolean // default: "false"
  storage                  String // default: "\"custom\""
  isMulti                  Boolean // default: "false"
  isRequired               Boolean // default: "false"
  isUnique                 Boolean // default: "false"
  isReadOnly               Boolean // default: "false"
  isSystem                 Boolean // default: "false"
  defaultJson              Json?
  sortOrder                Int // default: "0"
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### SavedView

Storage kind: **real Prisma table**.

```prisma
model SavedView {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  objectId                 String
  object                   ObjectDef
  ownerUserId              String
  name                     String
  layout                   String // default: "\"grid\""
  configJson               Json
  isShared                 Boolean // default: "false"
  isDefault                Boolean // default: "false"
  sortOrder                Int // default: "0"
  deletedAt                DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### DetailLayout

Storage kind: **real Prisma table**.

```prisma
model DetailLayout {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  objectId                 String
  object                   ObjectDef
  sectionsJson             Json
  railObjectsJson          Json?
  feedKindsJson            Json?
  isDefault                Boolean // default: "true"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Record

Storage kind: **real Prisma table**.

```prisma
model Record {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  objectId                 String
  valuesJson               Json // default: "\"{}\""
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### RecordLink

Storage kind: **real Prisma table**.

```prisma
model RecordLink {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  fromObject               String
  fromId                   String
  attribute                String?
  toObject                 String
  toId                     String
  noteId                   String?
  note                     Note? // relation: NoteLinks
  taskId                   String?
  task                     Task? // relation: TaskLinks
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### FieldHistory

Storage kind: **real Prisma table**.

```prisma
model FieldHistory {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  objectSlug               String
  recordId                 String
  attribute                String
  oldJson                  Json?
  newJson                  Json?
  changedByUserId          String?
  changeSource             String // default: "\"user\""
  reason                   String?
  changedAt                DateTime // default: "now()"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Provenance

Storage kind: **real Prisma table**.

```prisma
model Provenance {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  objectSlug               String
  recordId                 String
  attribute                String
  value                    Json?
  previousValue            Json?
  source                   String
  sourceRef                Json?
  evidenceSnippet          String?
  confidence               Float?
  status                   String // default: "\"unverified\""
  statusBy                 String?
  statusAt                 DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Email

Storage kind: **real Prisma table**.

```prisma
model Email {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  companyId                String?
  company                  Company?
  dealId                   String?
  deal                     Deal?
  mailAccountId            String?
  mailAccount              MailAccount?
  direction                String
  subject                  String?
  bodyHtml                 String?
  bodyText                 String?
  snippet                  String?
  internetMessageId        String
  conversationId           String?
  inReplyTo                String?
  references               String[] // default: "[]"
  importance               String // default: "\"normal\""
  isRead                   Boolean // default: "false"
  isDraft                  Boolean // default: "false"
  hasAttachments           Boolean // default: "false"
  provider                 String?
  providerMessageId        String?
  providerThreadId         String?
  folderOrLabels           String[] // default: "[]"
  webLink                  String?
  syncCursor               String?
  sentAt                   DateTime?
  receivedAt               DateTime?
  participants             EmailParticipant[]
  attachments              EmailAttachment[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### EmailParticipant

Storage kind: **real Prisma table**.

```prisma
model EmailParticipant {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  emailId                  String
  email                    Email
  role                     String
  name                     String?
  address                  String
  personId                 String?
  person                   Person?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### EmailAttachment

Storage kind: **real Prisma table**.

```prisma
model EmailAttachment {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  emailId                  String
  email                    Email
  filename                 String?
  contentType              String?
  sizeBytes                Int?
  isInline                 Boolean // default: "false"
  contentId                String?
  storageUrl               String?
  providerAttachmentId     String?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### SmsMessage

Storage kind: **real Prisma table**.

```prisma
model SmsMessage {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  personId                 String?
  person                   Person?
  companyId                String?
  company                  Company?
  dealId                   String?
  deal                     Deal?
  mailboxUserId            String?
  mailboxUser              User? // relation: SmsMailbox
  phoneNumberId            String?
  fromE164                 String
  toE164                   String
  direction                String
  body                     String?
  status                   String // default: "\"queued\""
  errorCode                String?
  errorMessage             String?
  numSegments              Int?
  numMedia                 Int // default: "0"
  channel                  String // default: "\"sms\""
  twilioSid                String?
  messagingServiceSid      String?
  price                    String?
  priceUnit                String?
  media                    MessageMedia[]
  sentAt                   DateTime?
  deliveredAt              DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### MessageMedia

Storage kind: **real Prisma table**.

```prisma
model MessageMedia {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  smsMessageId             String
  message                  SmsMessage
  contentType              String
  storageUrl               String?
  twilioMediaSid           String?
  sizeBytes                Int?
  sortOrder                Int // default: "0"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Meeting

Storage kind: **real Prisma table**.

```prisma
model Meeting {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  companyId                String?
  company                  Company?
  dealId                   String?
  deal                     Deal?
  title                    String
  description              String?
  location                 String?
  joinUrl                  String?
  conferenceProvider       String?
  isAllDay                 Boolean // default: "false"
  startsAt                 DateTime
  endsAt                   DateTime
  timeZone                 String?
  status                   String // default: "\"confirmed\""
  organizerEmail           String?
  organizerPersonId        String?
  organizerPerson          Person? // relation: MeetingOrganizer
  provider                 String?
  providerEventId          String?
  iCalUid                  String?
  recurringEventId         String?
  syncCursor               String?
  webLink                  String?
  recordingUrl             String?
  recordingProvider        String?
  transcriptStatus         String?
  externalRecordingId      String?
  attendees                MeetingAttendee[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### MeetingAttendee

Storage kind: **real Prisma table**.

```prisma
model MeetingAttendee {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  meetingId                String
  meeting                  Meeting
  name                     String?
  email                    String
  personId                 String?
  person                   Person?
  responseStatus           String // default: "\"needs_action\""
  isOrganizer              Boolean // default: "false"
  isOptional               Boolean // default: "false"
  isResource               Boolean // default: "false"
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### ActivityEntry

Storage kind: **real Prisma table**.

```prisma
model ActivityEntry {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  sourceType               String
  sourceId                 String
  summary                  String
  preview                  String?
  timelineVersion          Int // default: "1"
  timelineTitle            String
  timelineSubtype          String?
  timelineIntensity        Int // default: "2"
  timelineDisplay          Json?
  timelineMarker           Json?
  direction                String?
  occurredAt               DateTime
  createdByUserId          String?
  createdByUser            User?
  companyId                String?
  company                  Company?
  personId                 String?
  person                   Person?
  dealId                   String?
  deal                     Deal?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### NotificationObject

Storage kind: **real Prisma table**.

```prisma
model NotificationObject {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  eventKey                 String
  actorUserId              String?
  actor                    User? // relation: NotificationActor
  verb                     String
  objectType               String
  objectId                 String
  sourceSnapshot           Json
  notifications            Notification[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Notification

Storage kind: **real Prisma table**.

```prisma
model Notification {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  notificationObjectId     String
  notificationObject       NotificationObject
  recipientUserId          String
  recipient                User // relation: NotificationRecipient
  readAt                   DateTime?
  archivedAt               DateTime?
  snoozedUntil             DateTime?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Task

Storage kind: **real Prisma table**.

```prisma
model Task {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  title                    String
  body                     String?
  type                     String // default: "\"todo\""
  priority                 String // default: "\"med\""
  commitment               String // default: "\"soft\""
  assigneeUserId           String?
  assignee                 User? // relation: TaskAssignee
  dueAt                    DateTime?
  remindAt                 DateTime?
  eventId                  String?
  origin                   String // default: "\"manual\""
  isDone                   Boolean // default: "false"
  doneAt                   DateTime?
  deletedAt                DateTime?
  deletedById              String?
  links                    RecordLink[] // relation: TaskLinks
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### Note

Storage kind: **real Prisma table**.

```prisma
model Note {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  bodyJson                 Json
  bodyText                 String
  authorUserId             String?
  author                   User? // relation: NoteAuthor
  deletedAt                DateTime?
  links                    RecordLink[] // relation: NoteLinks
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### List

Storage kind: **real Prisma table**.

```prisma
model List {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  name                     String
  slug                     String
  objectSlug               String
  description              String?
  icon                     String?
  ownerUserId              String?
  isShared                 Boolean // default: "false"
  sortOrder                Int // default: "0"
  isArchived               Boolean // default: "false"
  deletedAt                DateTime?
  entries                  ListEntry[]
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```

### ListEntry

Storage kind: **real Prisma table**.

```prisma
model ListEntry {
  id                       String // id; default: "cuid()"
  orgId                    String
  org                      Org
  listId                   String
  list                     List
  objectSlug               String
  targetId                 String
  valuesJson               Json // default: "\"{}\""
  position                 Int?
  addedByUserId            String?
  createdAt                DateTime // default: "now()"
  updatedAt                DateTime // updatedAt
}
```
