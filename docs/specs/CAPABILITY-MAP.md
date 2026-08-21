# Capability Map: Dialer System Rebuild

This initiative rebuilds the Maincar calling platform as six independently deliverable modules in maincar-2.

## Module Dependencies

| Module ID | Responsibility | Depends On | Status |
|-----------|---|---|---|
| `numbers` | Buy, search, assign, activate phone numbers via Twilio API | — | Foundational |
| `devices` | Microphone/speaker detection, audio device selection | — | Foundational |
| `outbound` | Initiate calls from browser, manage call state, end calls | `numbers`, `devices` | Core flow |
| `inbound` | Receive calls, answer with greeting, record voicemail | `numbers` | Core flow |
| `voicemail-library` | Pre-recorded message CRUD, defaults, audio handling | `devices` | Optional enhancement |
| `voicemail-inbox` | View voicemail history, transcripts, playback | `inbound` | Discovery/review |

## Build Order

**Phase 1 (Foundation):** `numbers` + `devices`  
**Phase 2 (Calling):** `outbound` + `inbound`  
**Phase 3 (Voicemail):** `voicemail-library` + `voicemail-inbox`

Each phase is independently shippable and testable.

## Module Scope (One-Sentence Each)

- **numbers**: Org members buy Twilio phone numbers, activate one per person for outbound calls.
- **devices**: Before calling, check microphone and speaker work; let user select which device.
- **outbound**: User dials a number, greenroom runs, Twilio bridges to browser, call ends cleanly.
- **inbound**: Caller reaches one of our numbers, hears greeting, records message, message lands in inbox.
- **voicemail-library**: Rep records audio clips, manages a library of pre-recorded drops, picks one default.
- **voicemail-inbox**: Voicemails appear as records in a list, showing transcript, duration, sender, time.

## Key Interfaces (Module Boundaries)

- **numbers** → **outbound**: `GET /api/numbers` lists user's active phone numbers (callerID resolution)
- **devices** → **outbound/inbound**: Microphone/speaker permission & device list via Web Audio API
- **outbound** → Twilio: Authenticated `/api/calls` initiates call, unauthenticated `/twilio/voice` webhook receives status
- **inbound** → Twilio: Unauthenticated `/twilio/voice` answers inbound, `/twilio/voice/voicemail-recording` receives recording
- **voicemail-library** → **inbound**: `GET /api/voicemail-drops/:id/audio` serves presigned URL for greeting playback
- **voicemail-inbox** → **inbound**: Inbound calls create `Call` records; recordings create `Voicemail` records with transcripts

## Assumptions (Review Before Approving)

1. **Twilio is the telephony provider** (not Vonage, Bandwidth, etc.)
2. **Org isolation**: Phone numbers are org-scoped; users can only call from numbers assigned to their org
3. **One active number per user**: A rep has N numbers, but only one is "active for outbound" at a time
4. **No team/shared numbers**: Each rep owns their own number(s); no shared team line
5. **Call recording is opt-in**: Rep chooses recording consent per call, stored with Call record
6. **Greenroom is a modal dialog**: Device check happens before call connects, not during
7. **Browser phone only**: No native iOS/Android app; web-based calling only (Twilio.js SDK)
8. **PostgreSQL + Prisma**: Existing maincar-2 stack, same database

---

**Next step:** Review this map. Confirm module boundaries, dependency direction, and build order. Once approved, I'll write detailed specs for each module.
