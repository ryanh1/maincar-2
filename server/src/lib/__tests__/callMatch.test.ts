// Unit tests for the number → CRM spine match (lib/callMatch.ts).
//
// The DB is a stub here: these prove the helper's own logic — org-scoped lookup,
// deterministic ordering, and the "unknown number → all-null, never throws"
// contract that lets a call to a stranger still log. The match against a REAL
// Postgres schema (and its org-isolation boundary) is proved in
// callMatch.integration.test.ts.
import { describe, expect, it, vi } from 'vitest'

import { matchCallToCrm, matchInboundCallerToCrm } from '../callMatch.js'

/** A stub Prisma/transaction client exposing only what the helper reads. */
function dbWith(findFirst: ReturnType<typeof vi.fn>) {
  return { personPhone: { findFirst } } as unknown as Parameters<typeof matchCallToCrm>[0]
}

function inboundDbWith(findMany: ReturnType<typeof vi.fn>) {
  return { personPhone: { findMany } } as unknown as Parameters<typeof matchInboundCallerToCrm>[0]
}

describe('matchCallToCrm', () => {
  it('resolves a known number to its person and their company', async () => {
    const findFirst = vi.fn().mockResolvedValue({ person: { id: 'person-1', companyId: 'company-1' } })

    const links = await matchCallToCrm(dbWith(findFirst), 'org-1', '+13035550199')

    expect(links).toEqual({ personId: 'person-1', companyId: 'company-1', dealId: null })
  })

  it('scopes the lookup to the org and matches on the exact e164, deterministically', async () => {
    const findFirst = vi.fn().mockResolvedValue({ person: { id: 'person-1', companyId: null } })

    await matchCallToCrm(dbWith(findFirst), 'org-1', '+13035550199')

    const args = findFirst.mock.calls[0][0]
    expect(args.where).toEqual({ orgId: 'org-1', e164: '+13035550199' })
    // A primary number wins, then the oldest — so a number held by more than one
    // person resolves the same way every time, not by arbitrary row order.
    expect(args.orderBy).toEqual([{ isPrimary: 'desc' }, { createdAt: 'asc' }])
  })

  it('returns a null company when the matched person has none', async () => {
    const findFirst = vi.fn().mockResolvedValue({ person: { id: 'person-1', companyId: null } })

    const links = await matchCallToCrm(dbWith(findFirst), 'org-1', '+13035550199')

    expect(links).toEqual({ personId: 'person-1', companyId: null, dealId: null })
  })

  it('returns all-null links for an unknown number, without throwing', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)

    const links = await matchCallToCrm(dbWith(findFirst), 'org-1', '+19998887777')

    expect(links).toEqual({ personId: null, companyId: null, dealId: null })
  })

  it('short-circuits an empty number without touching the database', async () => {
    const findFirst = vi.fn()

    const links = await matchCallToCrm(dbWith(findFirst), 'org-1', '   ')

    expect(links).toEqual({ personId: null, companyId: null, dealId: null })
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('never resolves a deal from a phone match (dealId stays null)', async () => {
    const findFirst = vi.fn().mockResolvedValue({ person: { id: 'person-1', companyId: 'company-1' } })

    const links = await matchCallToCrm(dbWith(findFirst), 'org-1', '+13035550199')

    expect(links.dealId).toBeNull()
  })
})

describe('matchInboundCallerToCrm', () => {
  it('links a normalized unique inbound number only within the called number’s organization', async () => {
    const findMany = vi.fn().mockResolvedValue([{ person: { id: 'person-1', companyId: 'company-1' } }])

    const links = await matchInboundCallerToCrm(inboundDbWith(findMany), 'org-1', ' +13035550199 ')

    expect(links).toEqual({ personId: 'person-1', companyId: 'company-1', dealId: null })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: 'org-1', e164: '+13035550199' },
      take: 2,
    }))
  })

  it('keeps an inbound call unlinked when the number has no match or more than one match', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { person: { id: 'person-1', companyId: 'company-1' } },
        { person: { id: 'person-2', companyId: 'company-2' } },
      ])

    await expect(matchInboundCallerToCrm(inboundDbWith(findMany), 'org-1', '+13035550199'))
      .resolves.toEqual({ personId: null, companyId: null, dealId: null })
    await expect(matchInboundCallerToCrm(inboundDbWith(findMany), 'org-1', '+13035550199'))
      .resolves.toEqual({ personId: null, companyId: null, dealId: null })
  })
})
