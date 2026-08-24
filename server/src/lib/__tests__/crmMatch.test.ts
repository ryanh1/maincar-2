import { describe, expect, it, vi } from 'vitest'

import {
  candidateCompanyDomains,
  classifyParticipant,
  attachEmailMatchInTx,
  attachMeetingMatchInTx,
  normalizeParticipantAddress,
  resolveParticipantsToCrm,
} from '../crmMatch.js'

describe('CRM participant matching primitives', () => {
  it('normalizes an address before matching it', () => {
    expect(normalizeParticipantAddress('  JANE@Sub.Acme.COM ')).toBe('jane@sub.acme.com')
  })

  it('tries a subdomain then each parent domain', () => {
    expect(candidateCompanyDomains('jane@events.eu.acme.com')).toEqual([
      'events.eu.acme.com',
      'eu.acme.com',
      'acme.com',
    ])
  })

  it('keeps an exact personal-domain contact eligible while blocking domain matching', () => {
    expect(classifyParticipant('jane@gmail.com')).toEqual({
      address: 'jane@gmail.com',
      eligibleForExactPerson: true,
      eligibleForCompanyDomain: false,
      exclusion: null,
    })
  })

  it('leaves role addresses to the capture-exclusion evaluator', () => {
    // Role-address exclusion is a configurable rule (captureExclusions.ts), not a
    // structural classification, so classifyParticipant no longer drops it here.
    expect(classifyParticipant('no-reply@acme.com').exclusion).toBeNull()
  })
})

describe('resolveParticipantsToCrm', () => {
  it('attaches a known contact on a personal domain to that person and company', async () => {
    const personEmailFindMany = vi.fn().mockResolvedValue([
      { address: 'jane@gmail.com', person: { id: 'person-1', companyId: 'company-1' } },
    ])
    const db = {
      personEmail: { findMany: personEmailFindMany },
      company: { findMany: vi.fn().mockResolvedValue([]) },
      deal: { findMany: vi.fn().mockResolvedValue([]) },
      activityEntry: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    }

    const result = await resolveParticipantsToCrm(db as never, {
      orgId: 'org-1',
      participants: [{ address: 'Jane@Gmail.com' }],
      occurredAt: new Date('2026-08-20T12:00:00.000Z'),
    })

    expect(result).toMatchObject({
      excluded: false,
      primaryPersonId: 'person-1',
      primaryCompanyId: 'company-1',
      companyIds: ['company-1'],
      dealId: null,
    })
    expect(personEmailFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', address: { in: ['jane@gmail.com'] } } }),
    )
    expect(db.company.findMany).not.toHaveBeenCalled()
  })

  it('attaches every company sharing an unknown participant domain and chooses the most recently active primary', async () => {
    const db = {
      personEmail: { findMany: vi.fn().mockResolvedValue([]) },
      company: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'company-old', domain: 'acme.com', alternateDomains: [], updatedAt: new Date('2026-08-01') },
          { id: 'company-new', domain: 'acme.com', alternateDomains: [], updatedAt: new Date('2026-08-19') },
        ]),
      },
      deal: { findMany: vi.fn().mockResolvedValue([]) },
      activityEntry: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    }

    const result = await resolveParticipantsToCrm(db as never, {
      orgId: 'org-1',
      participants: [{ address: 'guest@sub.acme.com' }],
      occurredAt: new Date('2026-08-20T12:00:00.000Z'),
    })

    expect(result).toMatchObject({
      primaryPersonId: null,
      primaryCompanyId: 'company-new',
      companyIds: ['company-new', 'company-old'],
      dealId: null,
    })
  })

  it('chooses an open deal owned by a participant before falling back to activity-date proximity', async () => {
    const db = {
      personEmail: { findMany: vi.fn().mockResolvedValue([]) },
      company: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'company-1', domain: 'acme.com', alternateDomains: [], updatedAt: new Date('2026-08-19') },
        ]),
      },
      deal: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'deal-near', ownerUserId: 'owner-other', updatedAt: new Date('2026-08-20') },
          { id: 'deal-owner', ownerUserId: 'owner-jane', updatedAt: new Date('2026-08-01') },
        ]),
      },
      activityEntry: { findMany: vi.fn().mockResolvedValue([{ dealId: 'deal-near', occurredAt: new Date('2026-08-20') }]) },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'owner-other', email: 'other@maincar.com' },
          { id: 'owner-jane', email: 'jane@acme.com' },
        ]),
      },
    }

    const result = await resolveParticipantsToCrm(db as never, {
      orgId: 'org-1',
      participants: [{ address: 'jane@acme.com', responseStatus: 'accepted' }],
      occurredAt: new Date('2026-08-20T12:00:00.000Z'),
    })

    expect(result.dealId).toBe('deal-owner')
  })

  it('falls back to the open deal with activity closest to the message date', async () => {
    const db = {
      personEmail: { findMany: vi.fn().mockResolvedValue([]) },
      company: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'company-1', domain: 'acme.com', alternateDomains: [], updatedAt: new Date('2026-08-19') },
        ]),
      },
      deal: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'deal-far', ownerUserId: null, updatedAt: new Date('2026-08-22') },
          { id: 'deal-near', ownerUserId: null, updatedAt: new Date('2026-08-01') },
        ]),
      },
      activityEntry: {
        findMany: vi.fn().mockResolvedValue([
          { dealId: 'deal-far', occurredAt: new Date('2026-07-01') },
          { dealId: 'deal-near', occurredAt: new Date('2026-08-20T11:30:00.000Z') },
        ]),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    }

    const result = await resolveParticipantsToCrm(db as never, {
      orgId: 'org-1',
      participants: [{ address: 'guest@acme.com' }],
      occurredAt: new Date('2026-08-20T12:00:00.000Z'),
    })

    expect(result.dealId).toBe('deal-near')
  })
})

describe('attachEmailMatchInTx', () => {
  it('writes primary links, every target link, participant identity, feed row, and rollups together', async () => {
    const tx = {
      email: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      emailParticipant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityLink: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 3 }) },
      person: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      company: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      deal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityEntry: { upsert: vi.fn().mockResolvedValue({ id: 'feed-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
    const email = {
      id: 'email-1', orgId: 'org-1', manualAttach: false, companyId: null, dealId: null,
      direction: 'inbound', subject: 'Hello', snippet: null, bodyText: null,
      sentAt: null, receivedAt: new Date('2026-08-20T12:00:00.000Z'), createdAt: new Date('2026-08-20T12:00:00.000Z'),
    }

    await expect(attachEmailMatchInTx(tx as never, email as never, {
      excluded: false, exclusion: null, primaryPersonId: 'person-1', primaryCompanyId: 'company-1',
      personIds: ['person-1'], personIdByAddress: { 'jane@acme.com': 'person-1' },
      companyIds: ['company-1'], dealId: 'deal-1',
    })).resolves.toBe(true)

    expect(tx.email.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'email-1', orgId: 'org-1', manualAttach: false },
      data: { companyId: 'company-1', dealId: 'deal-1' },
    }))
    expect(tx.emailParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: 'org-1', emailId: 'email-1', address: 'jane@acme.com' }, data: { personId: 'person-1' },
    }))
    expect(tx.activityLink.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ targetType: 'person', targetId: 'person-1' }),
        expect.objectContaining({ targetType: 'company', targetId: 'company-1', isPrimary: true }),
        expect.objectContaining({ targetType: 'deal', targetId: 'deal-1' }),
      ]),
    }))
    expect(tx.activityEntry.upsert).toHaveBeenCalledOnce()
    expect(tx.person.updateMany).toHaveBeenCalledTimes(2)
    expect(tx.company.updateMany).toHaveBeenCalledOnce()
    expect(tx.deal.updateMany).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        actorId: 'system',
        action: 'activity_attach',
        objectType: 'email',
        objectId: 'email-1',
        diffJson: {
          targets: expect.arrayContaining([
            expect.objectContaining({ targetType: 'person', targetId: 'person-1' }),
            expect.objectContaining({ targetType: 'company', targetId: 'company-1' }),
            expect.objectContaining({ targetType: 'deal', targetId: 'deal-1' }),
          ]),
        },
      }),
    })
  })

  it('does not overwrite an activity manually attached by a user', async () => {
    const tx = { email: { updateMany: vi.fn() } }
    const email = { id: 'email-1', orgId: 'org-1', manualAttach: true }
    const matched = { ...{ excluded: false, exclusion: null, primaryPersonId: null, primaryCompanyId: 'company-1', personIds: [], personIdByAddress: {}, companyIds: ['company-1'], dealId: null } }

    await expect(attachEmailMatchInTx(tx as never, email as never, matched)).resolves.toBe(false)
    expect(tx.email.updateMany).not.toHaveBeenCalled()
  })
})

describe('attachMeetingMatchInTx', () => {
  it('writes a meeting attach audit in the same transaction slice', async () => {
    const tx = {
      meeting: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      meetingAttendee: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityLink: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      person: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      company: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      deal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityEntry: { upsert: vi.fn().mockResolvedValue({ id: 'feed-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
    const meeting = {
      id: 'meeting-1', orgId: 'org-1', manualAttach: false, companyId: null, dealId: null,
      organizerEmail: null, title: 'Discovery', description: null,
      startsAt: new Date('2026-08-20T12:00:00.000Z'),
      endsAt: new Date('2026-08-20T12:30:00.000Z'),
      createdAt: new Date('2026-08-20T12:00:00.000Z'),
    }

    await expect(attachMeetingMatchInTx(tx as never, meeting as never, {
      excluded: false, exclusion: null, primaryPersonId: null, primaryCompanyId: 'company-1',
      personIds: [], personIdByAddress: {}, companyIds: ['company-1'], dealId: null,
    })).resolves.toBe(true)

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity_attach',
        objectType: 'meeting',
        objectId: 'meeting-1',
      }),
    })
  })
})
