/**
 * Parsing and ordering for the member list.
 *
 * Split out of the route so the sort allow-list and the tie-break live in one
 * place that a test can reach directly. A sort key is user input: passing a raw
 * query param through as a Prisma `orderBy` key lets a caller sort by any column
 * on the table.
 */
import { z } from 'zod'

import type { Prisma } from '../generated/prisma/client.js'
import { MEMBERSHIP_ROLES } from './roles.js'

export const MEMBER_DEFAULT_PAGE_SIZE = 25

// 200, not 25: the pickers that need "everyone in this org" in one call would
// otherwise page, and a picker that pages hides people who are really there.
export const MEMBER_MAX_PAGE_SIZE = 200

export const MEMBER_SORT_COLUMNS = ['name', 'email', 'roles', 'joinedAt'] as const
export type MemberSortColumn = (typeof MEMBER_SORT_COLUMNS)[number]

/**
 * `.catch(...)` on every field rather than an error.
 *
 * A hand-edited or stale query string should render the default list, not a 400
 * the person cannot read or fix. Nothing here is destructive, so there is no
 * value in refusing.
 */
export const memberListQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MEMBER_MAX_PAGE_SIZE)
    .catch(MEMBER_DEFAULT_PAGE_SIZE),
  sort: z.enum(MEMBER_SORT_COLUMNS).catch('joinedAt'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  q: z.string().trim().max(120).catch(''),
  // Express hands a repeated param back as an array and a single one as a
  // string, so both shapes are normalised before the allow-list runs. Anything
  // outside the vocabulary is dropped, not refused — a stale link should show
  // the list, not an error.
  role: z
    .preprocess(
      (value) => {
        const raw = Array.isArray(value) ? value : value === undefined ? [] : [value]
        return raw.filter((entry): entry is string => typeof entry === 'string')
      },
      z.array(z.string()),
    )
    .transform((roles) => roles.filter((role) => (MEMBERSHIP_ROLES as string[]).includes(role)))
    .catch([]),
})

export type MemberListQuery = z.infer<typeof memberListQuery>

/**
 * The role filter, as a Prisma `hasSome`.
 *
 * Filtering a scalar list is something Prisma CAN do — it is only ORDERING by
 * one it cannot. So this narrows the query itself, which keeps `total` and the
 * page boundaries honest. Filtering in the browser would page against a set the
 * server never counted.
 */
export function memberRoleFilter(roles: string[]): Prisma.MembershipWhereInput | null {
  if (roles.length === 0) return null
  return { roles: { hasSome: roles } }
}

/** Case-insensitive match across the two things a person searches a member by. */
export function memberSearchFilter(q: string): Prisma.MembershipWhereInput | null {
  if (!q) return null
  return {
    OR: [
      { user: { firstName: { contains: q, mode: 'insensitive' } } },
      { user: { lastName: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
    ],
  }
}

/**
 * The table's sort key as a Prisma `orderBy`, always tie-broken.
 *
 * Every branch ends in `createdAt asc`. Without a tie-break Postgres is free to
 * return equal rows in a different order per query, so page 2 becomes a reshuffle
 * of page 1 and a member can appear twice or not at all.
 *
 * "roles" is deliberately NOT handled here — Prisma cannot `orderBy` a scalar
 * list. It falls back to email order, which is what the caller sees, rather than
 * a raw SQL query this route does not need yet.
 */
export function memberOrderBy(
  sort: MemberSortColumn,
  dir: 'asc' | 'desc',
): Prisma.MembershipOrderByWithRelationInput[] {
  const stable: Prisma.MembershipOrderByWithRelationInput = { createdAt: 'asc' }
  switch (sort) {
    case 'name':
      // Sorting by name must not dump the unnamed at the end: a member who never
      // set one sorts by the address the table falls back to showing.
      return [
        { user: { firstName: { sort: dir, nulls: 'last' } } },
        { user: { lastName: { sort: dir, nulls: 'last' } } },
        { user: { email: dir } },
        stable,
      ]
    case 'joinedAt':
      return [{ createdAt: dir }, stable]
    case 'roles':
    case 'email':
      return [{ user: { email: dir } }, stable]
  }
}
