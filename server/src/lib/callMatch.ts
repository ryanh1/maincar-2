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

/**
 * The matched PersonPhone row, flattened — everything the dialer needs to know
 * about the number it is about to call.
 *
 * It carries more than the CRM links because the SAME row answers two questions
 * at dial time, and they must be answered from ONE read: who is this (the links)
 * and may we call them at all (MAI-201, the compliance guard in lib/dialGuard.ts).
 * Two reads could disagree — a number marked do-not-call between them would be
 * dialed and logged against the person who asked us not to.
 */
export interface DialTarget {
  phoneId: string
  /** Legal, permanent, deliberate — and deliberately NOT folded into `status`. */
  isDnc: boolean
  dncReason: string | null
  /** Deliverability: reachable | unverified | dead. */
  status: string
  /** never_valid | no_longer_in_service | wrong_person — the reason behind "dead". */
  statusReason: string | null
  personId: string
  companyId: string | null
  /** IANA, from the PERSON. Null when nobody has recorded where they are. */
  personTimeZone: string | null
}

const NO_MATCH: CallCrmLinks = { personId: null, companyId: null, dealId: null }

/**
 * Resolve a counterparty number to the person who owns it within one org.
 *
 * `db` is a Prisma client OR a transaction client, so the lookup can run inside
 * the same transaction that writes the Call row — the full PrismaClient is a
 * superset of TransactionClient, so both satisfy this type.
 *
 * The match is scoped to `orgId`, always: a number belonging to another tenant's
 * person must never resolve here (org isolation, rules/database-and-prisma.md).
 * The same e164 can belong to more than one person (@@unique is [personId, e164],
 * not global), so the lookup is made deterministic — a primary number wins, then
 * the oldest — rather than left to arbitrary row order.
 *
 * An unknown number is `null`, never a throw: a call to a stranger still logs.
 */
export async function resolveDialTarget(
  db: Prisma.TransactionClient,
  orgId: string,
  counterpartyE164: string,
): Promise<DialTarget | null> {
  const e164 = counterpartyE164.trim()
  if (!e164) return null

  const phone = await db.personPhone.findFirst({
    where: { orgId, e164 },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      isDnc: true,
      dncReason: true,
      status: true,
      reason: true,
      person: { select: { id: true, companyId: true, timeZone: true } },
    },
  })
  if (!phone?.person) return null

  return {
    phoneId: phone.id,
    isDnc: phone.isDnc ?? false,
    dncReason: phone.dncReason ?? null,
    status: phone.status ?? 'unverified',
    statusReason: phone.reason ?? null,
    personId: phone.person.id,
    companyId: phone.person.companyId,
    personTimeZone: phone.person.timeZone ?? null,
  }
}

/**
 * The three Call columns, from a resolved target.
 *
 * `dealId` is never filled in here. A phone number identifies a person, not one
 * of their possibly-many deals, so picking one would be a guess — see the file
 * header.
 */
export function crmLinksFromTarget(target: DialTarget | null): CallCrmLinks {
  if (!target) return NO_MATCH
  return { personId: target.personId, companyId: target.companyId, dealId: null }
}

/**
 * Resolve a counterparty number straight to the three Call columns.
 *
 * The convenience form of {@link resolveDialTarget} for a caller that only wants
 * the links. The dial path does NOT use it: that path needs the compliance
 * fields off the same row, so it holds the target itself.
 */
export async function matchCallToCrm(
  db: Prisma.TransactionClient,
  orgId: string,
  counterpartyE164: string,
): Promise<CallCrmLinks> {
  return crmLinksFromTarget(await resolveDialTarget(db, orgId, counterpartyE164))
}

/**
 * Resolve an inbound caller only when one CRM phone owns the normalized number.
 *
 * An inbound screen-pop must never guess between two contacts that share a
 * number. Unlike outbound dialing, where a primary phone is a deliberate
 * selection rule, this leaves an ambiguous caller unlinked until a person
 * resolves it in the CRM.
 */
export async function matchInboundCallerToCrm(
  db: Prisma.TransactionClient,
  orgId: string,
  inboundE164: string,
): Promise<CallCrmLinks> {
  const e164 = inboundE164.trim()
  if (!e164) return NO_MATCH

  const phones = await db.personPhone.findMany({
    where: { orgId, e164 },
    take: 2,
    select: { person: { select: { id: true, companyId: true } } },
  })
  if (phones.length !== 1) return NO_MATCH

  const person = phones[0]?.person
  return person
    ? { personId: person.id, companyId: person.companyId, dealId: null }
    : NO_MATCH
}
