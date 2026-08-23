/**
 * The one server-side ordering rule for a person's dialable phone values.
 *
 * Power Dial records attempted phone IDs for a session and asks this resolver
 * for the next usable row; it never recreates this ordering in the client.
 */
import type { Prisma } from '../generated/prisma/client.js'

export interface PersonPhoneCandidate {
  id: string
  e164: string
  position: number
  isPrimary: boolean
  isDnc: boolean
  /** reachable | unverified | dead */
  status: string
}

export interface ResolveNextUsablePersonPhoneInput {
  phones: readonly PersonPhoneCandidate[]
  attemptedPhoneIds: readonly string[]
}

export type NextUsablePersonPhone =
  | { kind: 'phone'; phone: PersonPhoneCandidate }
  | { kind: 'exhausted' }

/**
 * Return the first phone Power Dial may try: primary first, then position order.
 * DNC and dead rows are never offered, and a session cannot receive a row it has
 * already attempted.
 */
export function resolveNextUsablePersonPhone(
  { phones, attemptedPhoneIds }: ResolveNextUsablePersonPhoneInput,
): NextUsablePersonPhone {
  const attempted = new Set(attemptedPhoneIds)
  const ordered = [...phones].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    return a.position - b.position
  })
  const phone = ordered.find((candidate) =>
    !attempted.has(candidate.id) && !candidate.isDnc && candidate.status !== 'dead',
  )

  return phone ? { kind: 'phone', phone } : { kind: 'exhausted' }
}

export interface ResolveNextUsablePersonPhoneForPersonInput {
  orgId: string
  personId: string
  attemptedPhoneIds: readonly string[]
}

/**
 * Load one person's phone values inside the tenant boundary, then apply the
 * shared resolver. A Prisma client or transaction client may be supplied by the
 * Power Dial service so this lookup can share its session transaction.
 */
export async function resolveNextUsablePersonPhoneForPerson(
  db: Prisma.TransactionClient,
  { orgId, personId, attemptedPhoneIds }: ResolveNextUsablePersonPhoneForPersonInput,
): Promise<NextUsablePersonPhone> {
  const phones = await db.personPhone.findMany({
    where: { orgId, personId },
    select: { id: true, e164: true, position: true, isPrimary: true, isDnc: true, status: true },
  })

  return resolveNextUsablePersonPhone({ phones, attemptedPhoneIds })
}
