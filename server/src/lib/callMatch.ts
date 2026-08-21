/**
 * Number → CRM spine match, run at call-log time (MAI-132, spec §6).
 *
 * Given the counterparty's E.164 number, resolve which Person the call is with —
 * and, through that person, their Company — so a Call row can be linked into the
 * CRM spine the moment it is written. This is the write side of Checkpoint A:
 * once the link is stored, a Person or Company page loads its recent calls in one
 * indexed round-trip (Call has @@index([orgId, personId, createdAt]) and its
 * company twin).
 *
 * Two rules the caller relies on:
 *   - An UNKNOWN number still logs. No match returns all-null links, never throws,
 *     so the call is written with personId/companyId/dealId left null (spec §6:
 *     "all nullable so an unknown number still logs a call").
 *   - dealId is NOT resolved here. A phone number identifies a person, not one of
 *     their possibly-many deals; picking a single deal from a phone match would be
 *     a guess. The column and its FK exist so a caller who knows the deal context
 *     (e.g. dialing from a deal page) can set it — the automatic match leaves it
 *     null.
 */
import type { Prisma } from '../generated/prisma/client.js'

/** The three nullable CRM links written onto a Call row. */
export interface CallCrmLinks {
  personId: string | null
  companyId: string | null
  dealId: string | null
}

const NO_MATCH: CallCrmLinks = { personId: null, companyId: null, dealId: null }

/**
 * Resolve a counterparty number to its Person and Company within one org.
 *
 * `db` is a Prisma client OR a transaction client, so the match can run inside the
 * same transaction that writes the Call row — the full PrismaClient is a superset
 * of TransactionClient, so both satisfy this type.
 *
 * The match is scoped to `orgId`, always: a number belonging to another tenant's
 * person must never resolve here (org isolation, rules/database-and-prisma.md).
 * The same e164 can belong to more than one person (@@unique is [personId, e164],
 * not global), so the lookup is made deterministic — a primary number wins, then
 * the oldest — rather than left to arbitrary row order.
 */
export async function matchCallToCrm(
  db: Prisma.TransactionClient,
  orgId: string,
  counterpartyE164: string,
): Promise<CallCrmLinks> {
  const e164 = counterpartyE164.trim()
  if (!e164) return NO_MATCH

  const phone = await db.personPhone.findFirst({
    where: { orgId, e164 },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { person: { select: { id: true, companyId: true } } },
  })
  if (!phone?.person) return NO_MATCH

  return { personId: phone.person.id, companyId: phone.person.companyId, dealId: null }
}
