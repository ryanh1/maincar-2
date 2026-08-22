// The activity feed against a REAL Postgres schema (see vitest.integration.config.ts
// and src/test/integration/*).
//
// The unit suite mocks Prisma, so it can only prove the route ASKS for the right
// query and that `recordActivityInTx` builds the right upsert. Everything this
// table is FOR lives one layer below that, in things only real Postgres can settle:
//
//   - the feed row and its Call COMMIT TOGETHER, and a rolled-back call leaves no
//     feed line claiming it happened;
//   - `@@unique([orgId, sourceType, sourceId])` actually FIRES, which it only does
//     because both key columns are NOT NULL — Postgres treats NULLs as distinct in
//     a unique index, so a nullable key column silently turns a unique constraint
//     into no constraint at all (MAI-187 is the bug we already have from exactly
//     that mistake on Email; this suite is the reason it cannot repeat here);
//   - a Company feed comes back in the right order from ONE indexed read, and the
//     "just my activity" actor filter narrows it correctly;
//   - the tenant key is half the lookup, so one org's source id cannot collide
//     with another's.
//
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import {
  activityFromCall,
  activityFromEmail,
  activityFromMeeting,
  activityFromNote,
  activityFromSms,
  activityFromStageChange,
  activityFromTask,
  recordActivityInTx,
  type NewActivityEntry,
} from '../../crm/activityFeed.js'
import { matchCallToCrm } from '../../lib/callMatch.js'
import type { Call, PrismaClient } from '../../generated/prisma/client.js'
import {
  createTestPrisma,
  seedCompany,
  seedMember,
  seedOrgWithAdmin,
  seedPerson,
  seedPersonPhone,
  seedPhoneNumber,
} from '../../test/integration/testPrisma.js'

const IN_FLIGHT_STATUSES = ['queued', 'ringing', 'in-progress']

class NoActiveNumber extends Error {}
class DoubleCall extends Error {}

describe('ActivityEntry feed (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('keeps task create, complete, and reopen as one retry-idempotent row in its own org', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId, name: 'Acme' })
    const task = await prisma.task.create({ data: { orgId, title: 'Follow up' } })

    await prisma.$transaction(async (tx) => {
      await recordActivityInTx(tx, activityFromTask(task, 'created', { companyId: company.id }, adminUserId))
      await recordActivityInTx(tx, activityFromTask(task, 'created', { companyId: company.id }, adminUserId))
    })

    const completedAt = new Date('2026-08-22T18:00:00.000Z')
    const completed = await prisma.task.update({ where: { id: task.id }, data: { isDone: true, doneAt: completedAt } })
    await prisma.$transaction((tx) =>
      recordActivityInTx(tx, activityFromTask(completed, 'completed', { companyId: company.id }, adminUserId)),
    )
    const reopened = await prisma.task.update({ where: { id: task.id }, data: { isDone: false, doneAt: null } })
    await prisma.$transaction((tx) =>
      recordActivityInTx(tx, activityFromTask(reopened, 'reopened', { companyId: company.id }, adminUserId)),
    )

    const rows = await prisma.activityEntry.findMany({ where: { orgId, sourceType: 'task', sourceId: task.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ companyId: company.id, timelineSubtype: 'reopened', timelineIntensity: 1 })
  })

  /**
   * The POST /api/orgs/:orgId/calls transaction body, verbatim: lock the caller's
   * active number, refuse a double call, match the dialed number to the CRM spine,
   * write the Call, then append its ONE feed row — all inside one transaction.
   *
   * It calls the REAL `matchCallToCrm`, the REAL `activityFromCall`, and the REAL
   * `recordActivityInTx`, so what is proved here is the shipped code path and not a
   * paraphrase of it. Only the Twilio dial is omitted: that is network I/O outside
   * the transaction, proved against a mock in the unit suite.
   *
   * The `search_path` line is a harness detail, not part of the route. This suite
   * runs in a per-run schema, and an unqualified table name in RAW SQL does not
   * inherit the adapter's schema option the way a Prisma query does. Production
   * runs on the default schema, so the route needs no equivalent.
   */
  async function placeCall(args: {
    orgId: string
    userId: string
    toE164: string
  }): Promise<Call> {
    const schema = inject('testSchema')
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
      const locked = await tx.$queryRaw<{ id: string; e164: string }[]>`
        SELECT "id", "e164" FROM "PhoneNumber"
        WHERE "orgId" = ${args.orgId}
          AND "assignedUserId" = ${args.userId}
          AND "isActiveForOutbound" = true
        FOR UPDATE
      `
      if (locked.length === 0) throw new NoActiveNumber()
      const fromE164 = locked[0].e164

      const existing = await tx.call.findFirst({
        where: {
          orgId: args.orgId,
          userId: args.userId,
          toE164: args.toE164,
          status: { in: IN_FLIGHT_STATUSES },
        },
      })
      if (existing) throw new DoubleCall()

      const crmLinks = await matchCallToCrm(tx, args.orgId, args.toE164)

      const call = await tx.call.create({
        data: {
          orgId: args.orgId,
          userId: args.userId,
          fromE164,
          toE164: args.toE164,
          direction: 'outbound',
          status: 'queued',
          recordingConsent: 'granted',
          personId: crmLinks.personId,
          companyId: crmLinks.companyId,
          dealId: crmLinks.dealId,
        },
      })

      await recordActivityInTx(tx, activityFromCall(call))

      return call
    })
  }

  /** An org with a rep who has an active outbound number — the minimum to dial. */
  async function seedDialer(): Promise<{
    orgId: string
    userId: string
    fromE164: string
  }> {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const number = await seedPhoneNumber(prisma, {
      orgId,
      assignedUserId: adminUserId,
      isActiveForOutbound: true,
    })
    return { orgId, userId: adminUserId, fromE164: number.e164 }
  }

  /** A feed row written straight through the helper, in its own transaction. */
  async function record(entry: NewActivityEntry): Promise<{ id: string }> {
    return prisma.$transaction((tx) => recordActivityInTx(tx, entry))
  }

  // ==========================================================================
  // The call path: exactly one feed row, atomic with the call
  // ==========================================================================

  it('appends EXACTLY ONE feed row when a call is logged through the real POST /calls path', async () => {
    const { orgId, userId } = await seedDialer()
    const toE164 = '+12025550111'

    const call = await placeCall({ orgId, userId, toE164 })

    const rows = await prisma.activityEntry.findMany({ where: { orgId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      orgId,
      sourceType: 'call',
      sourceId: call.id,
      direction: 'outbound',
      createdByUserId: userId,
    })
    // The line paints itself: the number dialed is IN the summary, so rendering the
    // feed needs no join back to Call.
    expect(rows[0].summary).toContain(toE164)
    // A just-queued call has no duration yet, so the line must not read "— 0s".
    expect(rows[0].summary).not.toContain('0s')
    // occurredAt is the call's own instant, not the moment the row was written.
    expect(rows[0].occurredAt.getTime()).toBe(call.createdAt.getTime())
    // The call builder writes the durable projection alongside the backwards-
    // compatible generic feed fields.
    expect(rows[0]).toMatchObject({
      timelineVersion: 1,
      timelineTitle: rows[0].summary,
      timelineSubtype: 'scheduled',
      timelineIntensity: 3,
      timelineDisplay: {},
      timelineMarker: null,
    })
  })

  it('persists all interaction projections independently for two organizations', async () => {
    async function writeAll(orgId: string, userId: string, label: string) {
      return prisma.$transaction(async (tx) => {
        const call = await tx.call.create({
          data: {
            orgId,
            userId,
            fromE164: '+12025550000',
            toE164: '+12025550123',
            direction: 'outbound',
            status: 'completed',
            durationS: 90,
          },
        })
        const email = await tx.email.create({
          data: {
            orgId,
            direction: 'inbound',
            subject: `${label} proposal`,
            snippet: `${label} mail preview`,
            internetMessageId: `<${label}@example.test>`,
            receivedAt: new Date('2026-08-22T12:00:00.000Z'),
          },
        })
        const sms = await tx.smsMessage.create({
          data: {
            orgId,
            mailboxUserId: userId,
            fromE164: '+12025550000',
            toE164: '+12025550123',
            direction: 'outbound',
            body: `${label} text`,
            status: 'delivered',
          },
        })
        const meeting = await tx.meeting.create({
          data: {
            orgId,
            title: `${label} discovery`,
            startsAt: new Date('2026-08-22T13:00:00.000Z'),
            endsAt: new Date('2026-08-22T14:00:00.000Z'),
            status: 'confirmed',
          },
        })
        const note = await tx.note.create({
          data: {
            orgId,
            authorUserId: userId,
            bodyJson: { type: 'doc' },
            bodyText: `${label} note`,
          },
        })
        const pipeline = await tx.pipeline.create({ data: { orgId, name: `${label} pipeline` } })
        const discovery = await tx.pipelineStage.create({
          data: { orgId, pipelineId: pipeline.id, name: 'Discovery', sortOrder: 1 },
        })
        const proposal = await tx.pipelineStage.create({
          data: { orgId, pipelineId: pipeline.id, name: 'Proposal', sortOrder: 2 },
        })
        const deal = await tx.deal.create({
          data: { orgId, name: `${label} deal`, pipelineId: pipeline.id, stageId: proposal.id },
        })

        await recordActivityInTx(tx, activityFromCall(call))
        await recordActivityInTx(tx, activityFromEmail(email))
        await recordActivityInTx(tx, activityFromSms(sms))
        await recordActivityInTx(tx, activityFromMeeting(meeting))
        await recordActivityInTx(tx, activityFromNote(note))
        await recordActivityInTx(
          tx,
          activityFromStageChange(deal, {
            sourceId: `${deal.id}:${discovery.id}:${proposal.id}:${deal.updatedAt.toISOString()}`,
            before: discovery.name,
            after: proposal.name,
            createdByUserId: userId,
          }),
        )
      })
    }

    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    await writeAll(a.orgId, a.adminUserId, 'Alpha')
    await writeAll(b.orgId, b.adminUserId, 'Beta')

    const rowsA = await prisma.activityEntry.findMany({ where: { orgId: a.orgId } })
    const rowsB = await prisma.activityEntry.findMany({ where: { orgId: b.orgId } })
    for (const rows of [rowsA, rowsB]) {
      expect(rows).toHaveLength(6)
      expect(rows.map((row) => row.sourceType).sort()).toEqual([
        'call', 'email', 'meeting', 'note', 'sms', 'stage_change',
      ])
      expect(rows.every((row) => row.timelineVersion === 1 && row.timelineTitle.length > 0)).toBe(true)
    }
    expect(rowsA.every((row) => row.orgId === a.orgId)).toBe(true)
    expect(rowsB.every((row) => row.orgId === b.orgId)).toBe(true)
    expect(rowsA.find((row) => row.sourceType === 'stage_change')?.timelineMarker).toEqual({
      type: 'stage_moved', before: 'Discovery', after: 'Proposal',
    })
  })

  it('persists a validated projection and deal marker on the same idempotent source row', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    await record({
      orgId,
      sourceType: 'stage_change',
      sourceId: 'deal-stage-1',
      summary: 'Deal moved to Proposal',
      occurredAt: new Date('2026-08-22T17:00:00Z'),
      timeline: {
        version: 1,
        title: 'Moved Enterprise renewal to Proposal',
        preview: 'Discovery → Proposal',
        subtype: 'stage_changed',
        intensity: 3,
        display: { actorName: 'Al Pha', dealName: 'Enterprise renewal' },
        marker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
      },
    })

    const row = await prisma.activityEntry.findFirstOrThrow({
      where: { orgId, sourceType: 'stage_change', sourceId: 'deal-stage-1' },
    })
    expect(row).toMatchObject({
      summary: 'Deal moved to Proposal',
      preview: 'Discovery → Proposal',
      timelineVersion: 1,
      timelineTitle: 'Moved Enterprise renewal to Proposal',
      timelineSubtype: 'stage_changed',
      timelineIntensity: 3,
      timelineDisplay: { actorName: 'Al Pha', dealName: 'Enterprise renewal' },
      timelineMarker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
    })
  })

  it('carries the CRM spine onto the feed row, so the account feed finds the call', async () => {
    const { orgId, userId } = await seedDialer()
    const company = await seedCompany(prisma, { orgId })
    const person = await seedPerson(prisma, { orgId, companyId: company.id })
    const toE164 = '+12025550222'
    await seedPersonPhone(prisma, { orgId, personId: person.id, e164: toE164, isPrimary: true })

    await placeCall({ orgId, userId, toE164 })

    const row = await prisma.activityEntry.findFirstOrThrow({ where: { orgId } })
    expect(row.companyId).toBe(company.id)
    expect(row.personId).toBe(person.id)
  })

  it('logs a call from an UNKNOWN number with null links — the match never blocks the feed', async () => {
    const { orgId, userId } = await seedDialer()

    await placeCall({ orgId, userId, toE164: '+12025550333' })

    const row = await prisma.activityEntry.findFirstOrThrow({ where: { orgId } })
    expect(row.companyId).toBeNull()
    expect(row.personId).toBeNull()
    expect(row.dealId).toBeNull()
  })

  // ==========================================================================
  // Atomicity: a rolled-back activity leaves no feed row
  // ==========================================================================

  it('leaves NO feed row when the transaction that wrote the activity rolls back', async () => {
    const { orgId, userId } = await seedDialer()
    const before = await prisma.activityEntry.count({ where: { orgId } })
    let callId = ''

    // A real transaction that writes BOTH rows and then fails. Postgres rolls the
    // whole thing back — which is the entire reason recordActivityInTx refuses a
    // non-transaction client.
    await expect(
      prisma.$transaction(async (tx) => {
        const call = await tx.call.create({
          data: {
            orgId,
            userId,
            fromE164: '+12025550000',
            toE164: '+12025550444',
            direction: 'outbound',
            status: 'queued',
          },
        })
        callId = call.id
        await recordActivityInTx(tx, activityFromCall(call))
        // Prove both rows are visible INSIDE the transaction before it dies, so
        // this test cannot pass by never having written anything.
        expect(await tx.activityEntry.count({ where: { orgId, sourceId: call.id } })).toBe(1)
        throw new Error('TWILIO_EXPLODED')
      }),
    ).rejects.toThrow('TWILIO_EXPLODED')

    // Neither row survived. The feed cannot claim a call that did not happen.
    expect(await prisma.activityEntry.count({ where: { orgId } })).toBe(before)
    expect(await prisma.activityEntry.count({ where: { orgId, sourceId: callId } })).toBe(0)
    expect(await prisma.call.count({ where: { id: callId } })).toBe(0)
  })

  it('rolls the CALL back too when the feed write is the thing that fails', async () => {
    const { orgId, userId } = await seedDialer()

    // An empty summary is refused by recordActivityInTx, inside the transaction, so
    // the activity goes with it. A feed row and its activity are one unit in BOTH
    // directions.
    await expect(
      prisma.$transaction(async (tx) => {
        const call = await tx.call.create({
          data: {
            orgId,
            userId,
            fromE164: '+12025550000',
            toE164: '+12025550555',
            direction: 'outbound',
            status: 'queued',
          },
        })
        await recordActivityInTx(tx, { ...activityFromCall(call), summary: '   ' })
      }),
    ).rejects.toThrow(/summary/i)

    expect(await prisma.call.count({ where: { orgId, toE164: '+12025550555' } })).toBe(0)
    expect(await prisma.activityEntry.count({ where: { orgId } })).toBe(0)
  })

  // ==========================================================================
  // Idempotency: the unique key actually fires
  // ==========================================================================

  it('does NOT duplicate when the same source row is saved again — it refreshes the one row', async () => {
    const { orgId, userId } = await seedDialer()
    const call = await placeCall({ orgId, userId, toE164: '+12025550666' })

    // The status webhook settles the call: duration known, status completed. The
    // writer re-saves, exactly as a retried job or a redelivered webhook would.
    const settled = await prisma.call.update({
      where: { id: call.id },
      data: { status: 'completed', durationS: 252, startedAt: new Date('2026-03-01T15:00:00Z') },
    })
    await record(activityFromCall(settled))
    // And a third time, because "delivered twice" is the case that matters.
    await record(activityFromCall(settled))

    const rows = await prisma.activityEntry.findMany({ where: { orgId, sourceId: call.id } })
    expect(rows).toHaveLength(1)
    // Refreshed, not stale: the settled duration and status are on the one row.
    expect(rows[0].summary).toContain('4m 12s')
    expect(rows[0].preview).toBe('completed')
    expect(rows[0].occurredAt.toISOString()).toBe('2026-03-01T15:00:00.000Z')
  })

  it('FIRES the unique index on a raw duplicate create — the constraint is real, not just an upsert convention', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const base = {
      orgId,
      sourceType: 'call',
      sourceId: 'src-dup-1',
      summary: 'Called +12025550777',
      timelineTitle: 'Called +12025550777',
      occurredAt: new Date('2026-03-02T10:00:00Z'),
    }
    await prisma.activityEntry.create({ data: base })

    // P2002 — the unique constraint. This is the assertion MAI-187 did not have:
    // if either key column were ever made nullable, Postgres would let this second
    // row through and the upsert above would quietly start appending duplicates.
    await expect(prisma.activityEntry.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    })
    expect(await prisma.activityEntry.count({ where: { orgId, sourceId: 'src-dup-1' } })).toBe(1)
  })

  it('keeps the unique key columns NON-NULL, which is what makes the constraint bite', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const schema = inject('testSchema')

    const columns = await prisma.$queryRawUnsafe<{ column_name: string; is_nullable: string }[]>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = 'ActivityEntry'
         AND column_name IN ('orgId', 'sourceType', 'sourceId')`,
    )
    expect(columns).toHaveLength(3)
    for (const column of columns) {
      expect(`${column.column_name}:${column.is_nullable}`).toBe(`${column.column_name}:NO`)
    }

    // And the database refuses the NULL directly, not merely by Prisma's typing.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}"."ActivityEntry"
           ("id", "orgId", "sourceType", "sourceId", "summary", "occurredAt", "updatedAt")
         VALUES ('null-key-1', '${orgId}', NULL, 'src-null-1', 'x', NOW(), NOW())`,
      ),
    ).rejects.toThrow()
  })

  it('scopes the key by tenant, so the same source id in two orgs is two rows', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const sourceId = 'shared-source-id'

    await record({
      orgId: a.orgId,
      sourceType: 'call',
      sourceId,
      summary: 'A called someone',
      occurredAt: new Date('2026-03-03T10:00:00Z'),
    })
    await record({
      orgId: b.orgId,
      sourceType: 'call',
      sourceId,
      summary: 'B called someone',
      occurredAt: new Date('2026-03-03T10:00:00Z'),
    })

    expect(await prisma.activityEntry.count({ where: { sourceId } })).toBe(2)
    const rowA = await prisma.activityEntry.findFirstOrThrow({ where: { orgId: a.orgId, sourceId } })
    expect(rowA.summary).toBe('A called someone')
  })

  it('treats a different sourceType on the same id as a different activity', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const sourceId = 'same-id-two-kinds'
    await record({
      orgId,
      sourceType: 'call',
      sourceId,
      summary: 'A call',
      occurredAt: new Date('2026-03-04T10:00:00Z'),
    })
    await record({
      orgId,
      sourceType: 'meeting',
      sourceId,
      summary: 'A meeting',
      occurredAt: new Date('2026-03-04T11:00:00Z'),
    })

    expect(await prisma.activityEntry.count({ where: { orgId, sourceId } })).toBe(2)
  })

  // ==========================================================================
  // The read: one indexed query, right rows, right order, actor filter
  // ==========================================================================

  describe('the Company feed read', () => {
    /**
     * One account with a mixed history, plus a second company and a second org, so
     * every assertion below has something it must NOT return.
     */
    async function seedFeed() {
      const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
      const colleague = await seedMember(prisma, orgId)
      const company = await seedCompany(prisma, { orgId, name: 'Acme Feed' })
      const other = await seedCompany(prisma, { orgId, name: 'Other Co' })

      // Written out of order on purpose: the feed's order is occurredAt, never
      // insertion order, which is the whole reason occurredAt is its own column.
      await record({
        orgId,
        sourceType: 'email',
        sourceId: 'e-1',
        summary: 'Email sent: Proposal',
        occurredAt: new Date('2026-02-02T10:00:00Z'),
        companyId: company.id,
        createdByUserId: adminUserId,
        direction: 'outbound',
      })
      await record({
        orgId,
        sourceType: 'call',
        sourceId: 'c-1',
        summary: 'Called +12025550001',
        occurredAt: new Date('2026-02-03T10:00:00Z'),
        companyId: company.id,
        createdByUserId: colleague.userId,
        direction: 'outbound',
      })
      await record({
        orgId,
        sourceType: 'meeting',
        sourceId: 'm-1',
        summary: 'Meeting: Kickoff',
        occurredAt: new Date('2026-02-01T10:00:00Z'),
        companyId: company.id,
        createdByUserId: adminUserId,
      })
      // Same org, different account — must never appear in Acme's feed.
      await record({
        orgId,
        sourceType: 'call',
        sourceId: 'c-other',
        summary: 'Called someone else',
        occurredAt: new Date('2026-02-04T10:00:00Z'),
        companyId: other.id,
        createdByUserId: adminUserId,
      })
      // No company at all — the org feed has it, the account feed does not.
      await record({
        orgId,
        sourceType: 'sms',
        sourceId: 's-loose',
        summary: 'Text from +12025559999',
        occurredAt: new Date('2026-02-05T10:00:00Z'),
        direction: 'inbound',
      })

      return { orgId, adminUserId, colleagueUserId: colleague.userId, companyId: company.id }
    }

    /** The route's query body, verbatim — one findMany, no include, no count. */
    function readFeed(where: Record<string, unknown>, dir: 'asc' | 'desc' = 'desc') {
      return prisma.activityEntry.findMany({
        where,
        orderBy: [{ occurredAt: dir }, { id: dir }],
        take: 26,
      })
    }

    it('returns the right rows in the right order, newest first', async () => {
      const { orgId, companyId } = await seedFeed()

      const rows = await readFeed({ orgId, companyId })

      expect(rows.map((r) => r.sourceId)).toEqual(['c-1', 'e-1', 'm-1'])
      // Nothing from the other account, and nothing unlinked.
      expect(rows.map((r) => r.sourceId)).not.toContain('c-other')
      expect(rows.map((r) => r.sourceId)).not.toContain('s-loose')
    })

    it('walks the account from the beginning when asked to', async () => {
      const { orgId, companyId } = await seedFeed()

      const rows = await readFeed({ orgId, companyId }, 'asc')

      expect(rows.map((r) => r.sourceId)).toEqual(['m-1', 'e-1', 'c-1'])
    })

    it('narrows to "just my activity" on the actor column', async () => {
      const { orgId, companyId, adminUserId, colleagueUserId } = await seedFeed()

      const mine = await readFeed({ orgId, companyId, createdByUserId: adminUserId })
      expect(mine.map((r) => r.sourceId)).toEqual(['e-1', 'm-1'])

      const theirs = await readFeed({ orgId, companyId, createdByUserId: colleagueUserId })
      expect(theirs.map((r) => r.sourceId)).toEqual(['c-1'])
    })

    it('applies the actor filter org-wide, with no account chosen', async () => {
      const { orgId, colleagueUserId } = await seedFeed()

      const rows = await readFeed({ orgId, createdByUserId: colleagueUserId })

      expect(rows.map((r) => r.sourceId)).toEqual(['c-1'])
    })

    it('returns the whole org feed, including rows linked to no account', async () => {
      const { orgId } = await seedFeed()

      const rows = await readFeed({ orgId })

      expect(rows.map((r) => r.sourceId)).toEqual(['s-loose', 'c-other', 'c-1', 'e-1', 'm-1'])
    })

    it('filters by activity kind and by direction', async () => {
      const { orgId, companyId } = await seedFeed()

      expect((await readFeed({ orgId, companyId, sourceType: 'call' })).map((r) => r.sourceId)).toEqual([
        'c-1',
      ])
      expect((await readFeed({ orgId, sourceType: 'sms' })).map((r) => r.sourceId)).toEqual([
        's-loose',
      ])
      expect((await readFeed({ orgId, direction: 'inbound' })).map((r) => r.sourceId)).toEqual([
        's-loose',
      ])
    })

    it('applies a HALF-OPEN date window, so a boundary row is not double-counted', async () => {
      const { orgId, companyId } = await seedFeed()

      const rows = await readFeed({
        orgId,
        companyId,
        occurredAt: { gte: new Date('2026-02-02T10:00:00Z'), lt: new Date('2026-02-03T10:00:00Z') },
      })

      // The row exactly on `gte` is in; the row exactly on `lt` is out.
      expect(rows.map((r) => r.sourceId)).toEqual(['e-1'])
    })

    it('keeps one org out of another org feed', async () => {
      const a = await seedFeed()
      const b = await seedFeed()

      const rowsA = await readFeed({ orgId: a.orgId })
      expect(rowsA.every((r) => r.orgId === a.orgId)).toBe(true)
      // A real company id from org B matches nothing under org A's tenant key.
      expect(await readFeed({ orgId: a.orgId, companyId: b.companyId })).toEqual([])
    })
  })

  // ==========================================================================
  // The indexes the feed depends on, and the deletion rules
  // ==========================================================================

  it('has the composite indexes that make each feed ONE indexed read with no join', async () => {
    const schema = inject('testSchema')
    const indexes = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = '${schema}' AND tablename = 'ActivityEntry'`,
    )
    const defs = indexes.map((i) => i.indexdef.replace(/\s+/g, ' '))

    // (tenant, scope, time) — in that order, so the range scan returns rows already
    // sorted and the planner never has to sort or join.
    for (const scope of ['companyId', 'personId', 'dealId', 'createdByUserId']) {
      expect(
        defs.some((d) => d.includes(`("orgId", "${scope}", "occurredAt")`)),
        `missing index on (orgId, ${scope}, occurredAt)`,
      ).toBe(true)
    }
    // The unscoped org feed.
    expect(defs.some((d) => d.includes('("orgId", "occurredAt")'))).toBe(true)
    // The idempotency key.
    expect(
      defs.some((d) => d.includes('UNIQUE') && d.includes('("orgId", "sourceType", "sourceId")')),
    ).toBe(true)
  })

  it('EXPLAINs the Company feed as an index scan with no join and no sort, at scale', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId })
    const schema = inject('testSchema')

    // A hundred rows on the account, buried in twenty thousand rows of the org's
    // other activity. The scale is the point: at sixty rows Postgres seq-scans
    // whatever indexes exist, because reading the whole table is genuinely cheaper,
    // and an assertion that passes there proves nothing about the shape the index
    // was built for. Bulk-inserted rather than written through recordActivityInTx
    // because twenty thousand round trips is a slow test, and the column shape it
    // writes is asserted everywhere else in this file.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."ActivityEntry"
         ("id", "orgId", "sourceType", "sourceId", "summary", "timelineTitle", "occurredAt", "updatedAt")
       SELECT 'noise-' || i, '${orgId}', 'call', 'noise-src-' || i, 'Noise ' || i, 'Noise ' || i,
              TIMESTAMP '2026-04-01 00:00:00' + (i * INTERVAL '1 minute'), NOW()
       FROM generate_series(1, 20000) AS i`,
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."ActivityEntry"
         ("id", "orgId", "sourceType", "sourceId", "summary", "occurredAt",
          "timelineTitle", "companyId", "createdByUserId", "updatedAt")
       SELECT 'bulk-' || i, '${orgId}', 'call', 'bulk-src-' || i, 'Activity ' || i,
              TIMESTAMP '2026-04-01 00:00:00' + (i * INTERVAL '1 hour'),
              'Activity ' || i, '${company.id}', '${adminUserId}', NOW()
       FROM generate_series(1, 100) AS i`,
    )
    await prisma.$executeRawUnsafe(`ANALYZE "${schema}"."ActivityEntry"`)

    const plan = await prisma.$queryRawUnsafe<Record<string, string>[]>(
      `EXPLAIN SELECT * FROM "${schema}"."ActivityEntry"
       WHERE "orgId" = '${orgId}' AND "companyId" = '${company.id}'
       ORDER BY "occurredAt" DESC LIMIT 25`,
    )
    const text = plan.map((r) => Object.values(r)[0]).join('\n')

    // The (orgId, companyId, occurredAt) index, used as a range scan.
    expect(text).toMatch(/Index Scan.*ActivityEntry_orgId_companyId_occurredAt_idx/s)
    // No join, and NO SORT STEP: the index returns the rows already in the order
    // the feed renders them, which is the acceptance criterion in one line.
    expect(text).not.toMatch(/\bJoin\b/)
    expect(text).not.toMatch(/^\s*(->\s*)?Sort\b/m)
    expect(text).not.toMatch(/Seq Scan/)

    // The actor filter has its own index, and lands on it the same way.
    const minePlan = await prisma.$queryRawUnsafe<Record<string, string>[]>(
      `EXPLAIN SELECT * FROM "${schema}"."ActivityEntry"
       WHERE "orgId" = '${orgId}' AND "createdByUserId" = '${adminUserId}'
       ORDER BY "occurredAt" DESC LIMIT 25`,
    )
    const mineText = minePlan.map((r) => Object.values(r)[0]).join('\n')
    expect(mineText).toMatch(/Index Scan.*ActivityEntry_orgId_createdByUserId_occurredAt_idx/s)
    expect(mineText).not.toMatch(/^\s*(->\s*)?Sort\b/m)
  })

  it('unlinks rather than erases when a Company is deleted — the history of what happened survives', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    const company = await seedCompany(prisma, { orgId })
    const entry = await record({
      orgId,
      sourceType: 'call',
      sourceId: 'survives-1',
      summary: 'Called +12025550888',
      occurredAt: new Date('2026-05-01T10:00:00Z'),
      companyId: company.id,
    })

    await prisma.company.deleteMany({ where: { id: company.id, orgId } })

    const row = await prisma.activityEntry.findFirstOrThrow({ where: { id: entry.id, orgId } })
    expect(row.companyId).toBeNull()
    expect(row.summary).toBe('Called +12025550888')
  })

  it('cascades the feed away with its org, so a deleted tenant leaves nothing behind', async () => {
    const { orgId } = await seedOrgWithAdmin(prisma)
    await record({
      orgId,
      sourceType: 'note',
      sourceId: 'cascade-1',
      summary: 'A note',
      occurredAt: new Date('2026-05-02T10:00:00Z'),
    })

    await prisma.org.deleteMany({ where: { id: orgId } })

    expect(await prisma.activityEntry.count({ where: { orgId } })).toBe(0)
  })
})
