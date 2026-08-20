// Shared helpers for the repetitive parts of a list endpoint. Use these instead
// of re-parsing `req.query` by hand in each route
// (CLAUDE.md → Server Route Patterns → Route Organization).

export interface Pagination {
  page: number
  limit: number
  offset: number
}

/**
 * Parses `page` and `limit` from a query string.
 *
 * `limit` is capped at 100 on purpose: an uncapped limit lets one caller ask for
 * every row in the table and turn a list endpoint into an outage.
 */
export function buildPaginationParams(query: Record<string, unknown>): Pagination {
  const parsedPage = parseInt(String(query.page ?? '1'), 10)
  const parsedLimit = parseInt(String(query.limit ?? '20'), 10)
  const page = Math.max(1, Number.isNaN(parsedPage) ? 1 : parsedPage)
  const limit = Math.min(100, Math.max(1, Number.isNaN(parsedLimit) ? 20 : parsedLimit))
  return { page, limit, offset: (page - 1) * limit }
}

type SearchFilter = { OR: Array<Record<string, { contains: string; mode: 'insensitive' }>> }

/** A case-insensitive `contains` across several fields, or undefined when blank. */
export function buildSearchFilter(
  search: string | undefined,
  fields: string[],
): SearchFilter | undefined {
  if (typeof search !== 'string' || !search.trim()) return undefined
  const trimmed = search.trim()
  return {
    OR: fields.map((field) => ({ [field]: { contains: trimmed, mode: 'insensitive' as const } })),
  }
}

/**
 * A Prisma date filter from two date strings.
 *
 * The end date is pushed to 23:59:59.999 so "up to and including this day" means
 * what a user expects. Without it, an end date of the 5th silently excludes
 * everything that happened on the 5th.
 */
export function buildDateRangeFilter(
  startDate: string | undefined,
  endDate: string | undefined,
): { gte?: Date; lte?: Date } | undefined {
  if (!startDate && !endDate) return undefined
  const filter: { gte?: Date; lte?: Date } = {}

  if (typeof startDate === 'string' && startDate) {
    const start = new Date(startDate)
    start.setHours(0, 0, 0, 0)
    filter.gte = start
  }

  if (typeof endDate === 'string' && endDate) {
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)
    filter.lte = end
  }

  return filter
}

/** Express gives a repeated query param as an array and a single one as a string. */
export function parseArrayParam(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value) return [value]
  return []
}

/**
 * Validates a sort field against an allow-list.
 *
 * The allow-list is not optional: passing a raw query param through as a Prisma
 * `orderBy` key lets a caller sort by any column in the table.
 */
export function buildSortParams(
  sortBy: unknown,
  sortDir: unknown,
  allowed: string[],
  fallback: string,
): { field: string; direction: 'asc' | 'desc' } {
  const field = typeof sortBy === 'string' && allowed.includes(sortBy) ? sortBy : fallback
  const direction = sortDir === 'asc' ? 'asc' : 'desc'
  return { field, direction }
}
