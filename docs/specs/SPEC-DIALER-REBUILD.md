# Spec: Dialer System Rebuild (maincar → maincar-2)

## Objective

Rebuild Maincar's calling platform in maincar-2, enabling org members to:
1. Buy and manage Twilio phone numbers
2. Check device readiness before calling (greenroom)
3. Make outbound calls with browser audio
4. Receive inbound calls with voicemail fallback
5. Record pre-recorded voicemail drops and send them on demand
6. Review call history and voicemail transcripts

This is a port of proven maincar calling code to the new org-scoped, multi-tenant architecture. No new features; high fidelity to the original UX.

## Tech Stack

- **Telephony:** Twilio Voice API (calls, recording, TwiML, webhooks)
- **Backend:** Express.js, Prisma ORM, PostgreSQL
- **Frontend:** React 18, Vite, Twilio.js SDK (browser calling)
- **Jobs:** pg-boss (async transcription, recording upload, audio conversion)
- **Storage:** MinIO S3-compatible buckets (voicemail audio, voicemail drops, call recordings)
- **Key dependencies:** `twilio`, `twilio-client`, `zod`, `sonner`, `react-query`

## Commands

```bash
# Development
npm run dev          # Start Vite + Express in parallel

# Testing
npm test             # Unit tests (vitest)
npm run test:integration  # Integration tests with real Postgres schema
npm run test:coverage # Coverage report

# Building
npm run build        # TypeScript + Vite bundle
npm run typecheck    # tsc --noEmit

# Linting & formatting
npm run lint         # ESLint
npm run lint:fix     # Fix eslint violations

# Database
npm run db:migrate   # Generate + apply Prisma migration
npm run db:seed      # Seed test data

# Docker (local development)
npm run docker:up    # Start Postgres + MinIO
npm run docker:down  # Stop services
```

## Project Structure

```
server/
  src/
    routes/
      calls.ts                 # Outbound calling + Twilio webhooks
      phone-numbers.ts         # Number procurement CRUD
      voicemail.ts             # Inbound + greeting/recording
      voicemail-inbox.ts       # Voicemail list + playback
      voicemail-drops.ts       # Pre-recorded message library
      voicemail-greeting.ts    # Personal greeting upload
    middleware/
      requireAuth.ts           # JWT verification
      verifyTwilioSignature.ts # Webhook signature validation
      twilioOrg.ts       # Extract org from Twilio URL
    lib/
      voiceIdentity.ts         # Encode/decode call participant identity
      recordingDecision.ts     # Consent & auto-recording logic
      phoneRecordMatch.ts      # Match inbound caller to contact
      mediaAssets.ts           # S3 presigned URLs, media storage
    jobs/
      transcribeVoicemail.ts   # Async transcription job
      uploadRecording.ts       # Async recording upload to S3
      transcodeDrop.ts         # Audio conversion for voicemail drops
      transcribeDrop.ts        # Transcription for voicemail drops
    dependencies/
      twilio.ts                # Twilio SDK wrapper, config, base URLs
      twilioCalls.ts           # Call control (hangup, recording fetch/delete)
      twilioVoiceTwiml.ts      # TwiML builders (dial, greeting, record, etc.)
    prisma/
      schema.prisma            # Database models
      migrations/              # Generated migrations
  test/
    lib/
      dialing.test.ts          # Call state machine tests
    routes/
      calls.test.ts            # Outbound call endpoint tests
      voicemail.test.ts        # Inbound + recording tests

vite/
  src/
    components/
      GreenRoom.tsx            # Device check modal (pre-call)
      DeviceCheck.tsx          # Microphone/speaker selector
      dialer/
        Dialer.tsx             # Main dock panel (collapsed/expanded)
        Dialer_Keypad.tsx      # Numeric keypad + DTMF
        Dialer_ActiveCall.tsx   # In-call controls (mute, hold, end)
        Dialer_RecordingDot.tsx # Recording consent indicator
        Dialer_Message.tsx      # Status messages during call
        DialerProvider.tsx      # Call state (React Context)
      calls/
        CallRibbon.tsx          # Transcript playback, call details
        CallTranscript.tsx      # Transcript rendering
    pages/
      Calls.tsx                # Call history list (server-side paged)
      CallRecord.tsx           # Single call detail page
      Voicemail.tsx            # Voicemail inbox list
      Voicemail_Detail.tsx     # Single voicemail detail
    hooks/
      callRecord/
        useGetCalls.ts         # Fetch call history
        useGetCallDetail.ts    # Fetch single call
        useCreateCall.ts       # Initiate outbound call
        useEndCall.ts          # Hang up call
      voicemail/
        useGetVoicemails.ts    # Fetch voicemail inbox
        useGetVoicemail.ts     # Fetch single voicemail
      devices/
        useGetDevices.ts       # List audio devices
        useGreenRoomDecision.ts # Device permission state
    lib/
      voiceIdentity.ts         # Decode call identity
      callRecordTypes.ts       # Type defs for Call, Voicemail
      greenRoom.ts             # Device check logic
      greenRoomSession.ts      # Session recording (skip on retry)
      phoneNumbers.ts          # Format/parse E.164
      datetime.ts              # Timezone-aware formatting

prisma/
  schema.prisma                # Database schema (see below)
```

## Data Model Overview

### Core Tables

```prisma
model Call {
  id                String    @id @default(cuid())
  orgId       String
  userId            String
  fromE164          String    // Caller ID (user's phone number)
  toE164            String    // Recipient
  direction         String    // "outbound" | "inbound"
  status            String    // queued, ringing, in-progress, completed, busy, failed, no-answer, canceled
  twilioCallSid     String?   @unique  // Twilio's call ID; webhooks look up by it
  recordingConsent  String?   // "declined" | "granted" | null
  recordingEnabled  Boolean?  // true if recording started
  recordingUrl      String?   // S3 URL to MP3
  transcriptStatus  String    // pending, done, failed, skipped-not-recorded
  transcript        String?
  durationS         Int?
  startedAt         DateTime?
  endedAt           DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

model Voicemail {
  id                String    @id @default(cuid())
  orgId       String
  callId            String    @unique  // Linked to inbound call
  audioUrl          String    // S3 URL to MP3
  transcriptStatus  String    // pending, done, failed
  transcript        String?
  durationS         Int
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

model PhoneNumber {
  id                String    @id @default(cuid())
  orgId       String
  assignedUserId    String    // User who owns this number
  e164              String    // +1234567890
  twilioSid         String?   // Twilio's SID; null until the provision job buys it
  status            String    // searching, active, releasing
  isActiveForOutbound Boolean @default(false)  // Only one per user can be true
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

model VoicemailGreeting {
  id                String    @id @default(cuid())
  orgId       String
  userId            String    // Rep's personal greeting
  mediaAssetId      String?   // S3 asset ID
  conversionStatus  String    // pending, done, failed
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

model VoicemailDrop {
  id                String    @id @default(cuid())
  orgId       String
  userId            String    // Drop owner
  name              String    // "Followup", "Callback request", etc.
  mediaAssetId      String    // S3 asset (user's upload)
  conversionStatus  String    // pending, done, failed
  transcriptStatus  String    // pending, done, failed
  transcript        String?
  isDefault         Boolean   @default(false)  // Only one per user
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}
```

## Code Style

### Route Handler (Authenticated Call)

```typescript
// ✅ Correct pattern from maincar
import { wrapRoute } from '../lib/fnWrapper.js'

callsRouter.post(
  '/calls',  // mounted at /api in app.ts
  requireAuth,
  wrapRoute('POST /api/orgs/:orgId/calls', async (req, res) => {
    // --- Parse & validate ---
    const body = createCallSchema.parse(req.body)
    
    // --- Verify ownership ---
    const org = await requireOrg(req, res)
    if (!org) return
    
    // --- Build call ---
    const caller = await prisma.phoneNumber.findFirst({
      where: { orgId: org.id, assignedUserId: req.userId, isActiveForOutbound: true }
    })
    if (!caller) throw new HttpError(400, 'No active phone number')
    
    // --- Create row & queue job ---
    const call = await prisma.call.create({
      data: {
        orgId: org.id,
        userId: req.userId!,
        fromE164: caller.e164,
        toE164: body.toE164,
        direction: 'outbound',
        status: 'queued'
      }
    })
    
    // --- Return immediately ---
    res.json({ call: serializeCall(call) })
  })
)

// ✅ Webhook (unauthenticated, signature-verified)
twilioVoiceWebhookRouter.post(
  '/twilio/voice',
  verifyTwilioSignature,
  express.urlencoded({ extended: false }),
  twimlRoute('POST /twilio/voice', async (req, res) => {
    // Twilio posts form-encoded, not JSON
    const { Direction, CallSid } = req.body
    
    if (isInboundLeg(Direction)) {
      // Answer inbound with TwiML
      res.type('text/xml').send(buildVoicemailTwiml(...))
    } else {
      // Dial outbound leg
      res.type('text/xml').send(buildDialTwiml(...))
    }
  })
)
```

### React Hook (Data Fetching)

```typescript
// ✅ Correct pattern: one hook per file, domain-organized
// hooks/callRecord/useGetCalls.ts
import { useQuery } from '@tanstack/react-query'
import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallListItem } from '@/lib/callRecordTypes'

export function useGetCalls(
  orgId: string,
  params: { page: number; limit: number; sort: string; dir: string; q: string }
) {
  return useQuery({
    queryKey: queryKeys.calls.list(orgId, params),
    queryFn: async () => {
      const data = await jsonFetch<{ calls: CallListItem[]; total: number }>(
        `/api/orgs/:orgId/calls?page=${params.page}&limit=${params.limit}&sort=${params.sort}&dir=${params.dir}&q=${params.q}`
      )
      return data
    },
    enabled: !!orgId
  })
}

// Usage in component
const { data, isLoading, error } = useGetCalls(orgId, { page: 1, limit: 25, sort: 'createdAt', dir: 'desc', q: '' })
```

### Component (UI)

```typescript
// ✅ Correct pattern: semantic HTML, Tailwind tokens only, no hard-coded colors
import { Dialer } from '@/components/dialer/Dialer'

export function CallsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg px-6">
        <Phone size={16} className="text-text-muted" aria-hidden />
        <h1 className="text-base font-semibold text-text">Calls</h1>
      </div>
      
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {/* Table, list, etc. */}
      </div>
    </div>
  )
}

// ✅ No hard-coded colors — all from theme
// ❌ WRONG: bg-emerald-500, text-green-600, #FF5733
```

## Testing Strategy

### Server: Two Test Suites

**Unit tests** (`src/**/*.test.ts`):
- Mock database (vi.mock)
- Mock Twilio SDK
- Test route handlers, business logic, state machines
- Command: `npm test`

**Integration tests** (`src/**/*.integration.test.ts`):
- Real PostgreSQL (unique schema per run)
- Real Twilio mocks (but no network calls)
- Test full workflows: buy number → make call → record voicemail
- Command: `npm run test:integration` (requires `docker:up`)

### Client: Component + Hook Tests

- Vitest + React Testing Library
- Mock `jsonFetch` and `useQuery`
- Test user interactions, async flows, error states
- Command: `npm test`

### Coverage

- Server: 80%+ line coverage
- Client: 70%+ line coverage
- Every new API endpoint tested (valid + invalid input, auth, org isolation)
- Every new component tested (render, interaction, error state)

## Boundaries

### Always Do

- **Org isolation:** Every query for org-scoped data includes `orgId` in the where clause (reads AND writes)
- **Test before commit:** `npm test` + `npm run typecheck` pass
- **Validate inputs:** Use zod for request bodies; return 400 on parse failure
- **No secrets in logs:** Log identifiers (`userId`, `orgId`), never tokens or full payloads
- **Twilio webhook signature verification:** Every Twilio endpoint uses `verifyTwilioSignature` middleware

### Ask First

- Adding a new Twilio capability (e.g., SIP trunking, conference calls)
- Changing phone number assignment model (e.g., shared team numbers)
- Adding non-Twilio telephony provider
- Persisting PII beyond call metadata (e.g., caller name, address)
- Changing recording consent model (e.g., always-record vs. opt-in)

### Never Do

- Hardcode Twilio account SID, auth token, or phone numbers in source code
- Use `process.env` outside `src/config.ts`
- Store Twilio recordings in app database; use S3 + presigned URLs only
- Create a `Call` row without a corresponding Twilio call (except for inbound)
- Mix Twilio SDK instantiation with business logic (wrap it in dependencies/)

## Success Criteria

### Phase 1: Foundation (numbers + devices)

- [ ] Org member can buy a Twilio number via UI (search → select → buy)
- [ ] Number is stored with user assignment and status tracking
- [ ] User can activate one number at a time for outbound calling
- [ ] Greenroom modal opens before call; device list populates from Web Audio API
- [ ] User can select microphone and speaker; choice persists to localStorage
- [ ] Device check detects missing/broken audio (no mic permission → shows permission request)
- [ ] All routes tested (unit + integration); unit tests mock Twilio, integration tests mock on network layer

### Phase 2: Calling (outbound + inbound)

- [ ] User opens dialer, enters number, greenroom runs, call initiates
- [ ] Twilio webhook receives call, bridges to browser; user hears ringing
- [ ] Call status updates in real-time: queued → ringing → in-progress → completed
- [ ] User can mute/unmute, end call; call row ends gracefully
- [ ] Inbound call to org number rings → greeted with personal greeting or default
- [ ] Caller can leave message; voicemail recorded and stored in S3
- [ ] Call history page lists all calls (outbound + inbound), sortable, searchable
- [ ] All routes tested; all webhooks signature-verified; org isolation verified (user from Org A cannot reach Org B's call data)

### Phase 3: Voicemail (library + inbox)

- [ ] User can upload audio file, name it, save as voicemail drop
- [ ] Drops convert to MP3 and transcribe asynchronously
- [ ] User can star one drop as default; library always has exactly one default
- [ ] Inbound calls play personal greeting if exists, else default greeting, else Twilio default
- [ ] Voicemail inbox page lists all voicemails with timestamp, duration, transcript, caller
- [ ] User can play voicemail, see transcript, delete voicemail
- [ ] All async jobs queue and process; failed transcriptions show error state
- [ ] All tests pass; coverage >75%

### Phase 4: Launch Readiness

- [ ] Spec matches deployed behavior (no silent divergence)
- [ ] All routes and webhooks tested (unit + integration)
- [ ] Rate limiting on call creation (prevent accidental loops)
- [ ] Logging covers user, org, call ID, route, status changes
- [ ] Error messages are actionable (not "something went wrong")
- [ ] No secrets in logs, network requests, or error responses

## Open Questions → Answers

**Q: Do we support call transfer?**  
A: No. Original maincar does not. Out of scope.

**Q: Can users record calls without consent?**  
A: No. Recording requires explicit opt-in per call. Stored with Call record as `recordingConsent` field.

**Q: What's the max voicemail length?**  
A: 120 seconds (2 minutes), same as original maincar.

**Q: Do voicemail greetings convert to MP3?**  
A: Yes. User uploads WebM/WAV; server converts to MP3 for Twilio playback.

**Q: Can a user belong to multiple orgs?**  
A: Yes. Each org assignment is a separate Membership row. Call/voicemail data is org-scoped via `orgId`.

**Q: Is there an admin dashboard for viewing team call stats?**  
A: No. Original maincar does not have this. Out of scope.

**Q: What happens if Twilio webhook doesn't arrive?**  
A: Call row stays in `queued` or `ringing` for 4 hours max (DIALED_STALE_MS backstop). Next manual action (close dialer) releases it.

---

## Glossary

- **E.164**: Phone number format: +country-code + area + number (e.g. +12015551234)
- **TwiML**: Twilio Markup Language; XML sent to Twilio to control call flow
- **Call SID**: Twilio's unique call identifier
- **Presigned URL**: Time-limited S3 URL; Twilio can fetch without AWS credentials
- **Greenroom**: Device check modal pre-call (Google Meet UX)
- **Voicemail drop**: Pre-recorded message played on inbound calls
- **Org isolation**: Data belonging to Org A is invisible to Org B, even with authentication

