# Dialer System Rebuild Documentation

This folder contains all documentation for rebuilding the Maincar calling platform in maincar-2.

## Structure

```
docs/
  specs/
    CAPABILITY-MAP.md        → Module decomposition (6 modules, dependencies, build order)
    SPEC-DIALER-REBUILD.md   → Complete detailed specification (9 sections, approved)
  decisions/
    DECISION-AUTH-LITA-LOADWIRE-VS-MAINCAR.md → Auth, tenancy, invites and roles: what we
                                                copy from which repo, and why (MAI-9)
  LINEAR_IMPORT.md           → How to import issues into Linear
  README.md                  → This file
```

## Key Documents

### 1. **CAPABILITY-MAP.md** (Read First)
- Defines 6 independently deliverable modules
- Shows dependency graph and build order
- Lists assumptions
- **Status: Approved**

### 2. **SPEC-DIALER-REBUILD.md** (Full Spec)
- Objective & overview
- Tech stack (Twilio, Prisma, React, Express)
- Data model (Call, Voicemail, PhoneNumber, VoicemailDrop schemas)
- Code style with real examples
- Testing strategy
- Boundaries (always do, ask first, never do)
- Success criteria per phase
- Glossary
- **Status: Approved**

### 3. **tasks/plan.md** (Implementation Plan)
- Architecture decisions
- Dependency graph visualization
- 4-phase breakdown with checkpoints
- Risks and mitigations
- Open questions

### 4. **tasks/linear-issues.md** (All 57 Issues)
- Complete issue specs (title, description, acceptance criteria, points, labels, dependencies)
- Organized by phase and module
- Ready to import into Linear
- **57 total issues: 12 (Phase 1) + 17 (Phase 2a) + 11 (Phase 2b) + 13 (Phase 3)**

### 5. **decisions/DECISION-AUTH-LITA-LOADWIRE-VS-MAINCAR.md** (Auth Decision Record)
- Ten decisions comparing `lita`, `loadwire` and `maincar` on tenancy, account creation,
  offboarding, roles, invite delivery, invite security, RLS, email verification, paging
  and self-service limits
- Each decision has both approaches, a pros/cons table, and a recommendation
- **Read before implementing MAI-5, MAI-6, MAI-7 or MAI-8**
- Includes a status table of what maincar-2 has already shipped against each decision
- **Status: Accepted (D7 — row-level security — still open)**

### 6. **LINEAR_IMPORT.md** (Import Guide)
- 3 methods to import issues (manual, CSV, API)
- Labeling strategy
- Dependency linking
- Checkpoint marking

## Phase Breakdown

| Phase | Modules | Issues | Duration | Deliverable |
|-------|---------|--------|----------|-------------|
| **1** | numbers, devices | 12 | ~3 days | Buy numbers, greenroom modal |
| **2a** | outbound | 17 | ~5 days | Make calls, history, recording |
| **2b** | inbound | 11 | ~3 days | Answer calls, voicemail inbox |
| **3** | voicemail-library | 13 | ~4 days | Voicemail drops, polish, launch |
| **Total** | — | **57** | **~2 weeks** | Production-ready dialer |

## Getting Started

1. **Read the specs** → Start with CAPABILITY-MAP.md, then SPEC-DIALER-REBUILD.md
2. **Import issues to Linear** → Follow LINEAR_IMPORT.md
3. **Start Phase 1** → Begin with MAI-1 (database schema)
4. **Follow checkpoints** → Complete each phase before moving to the next
5. **Update CLAUDE.md** → Already done (move tickets to "In Review" when done)

## Rules & Standards

See [CLAUDE.md](../CLAUDE.md) for project-wide rules:
- Code style (no hard-coded colors, semantic HTML)
- Testing requirements (unit + integration, >75% coverage)
- Timezone handling
- Linear workflow (move to "In Review" when done)

## Twilio Setup (Before Phase 1)

Before starting work, ensure:
- Twilio account SID and auth token
- Test phone number (buy from Twilio)
- Webhook URLs configured (will be prod domain)
- S3/MinIO buckets ready (voicemail audio, recordings, drops)

## Key References

- **Original maincar implementation** → Documents calling architecture, proven patterns
- **Maincar CLAUDE.md** → House style for phone number handling, org isolation, logging
- **Twilio SDKs** → `twilio-client` (browser), `twilio` (Node.js)
- **Prisma** → Database ORM, migrations, schema-first approach

## Handoff Notes

- **No new features** — This is a port. Every feature already proven in maincar.
- **Org isolation critical** — Every query includes orgId in where clause
- **Async jobs are load-bearing** → Recording upload, transcription, audio conversion happen in pg-boss
- **Greenroom is a hint, not a lock** — User can call even if device check fails
- **Call state machine** → queued → ringing → in-progress → completed (or terminal error state)

## Questions?

Refer to the **Open Questions** section in SPEC-DIALER-REBUILD.md or add them to the Linear issues.

---

**Last updated:** 2026-08-20  
**Status:** Specs approved, issues ready for import
