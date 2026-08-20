import { describe, expect, it } from 'vitest'

import {
  buildDateRangeFilter,
  buildPaginationParams,
  buildSearchFilter,
  buildSortParams,
  parseArrayParam,
} from '../queryHelpers.js'

describe('buildPaginationParams', () => {
  it('defaults to page 1, limit 20', () => {
    expect(buildPaginationParams({})).toEqual({ page: 1, limit: 20, offset: 0 })
  })

  it('computes the offset from page and limit', () => {
    expect(buildPaginationParams({ page: '3', limit: '25' })).toEqual({
      page: 3,
      limit: 25,
      offset: 50,
    })
  })

  it('caps the limit at 100, so one caller cannot ask for the whole table', () => {
    expect(buildPaginationParams({ limit: '5000' }).limit).toBe(100)
  })

  it('falls back to the defaults for junk input', () => {
    expect(buildPaginationParams({ page: 'abc', limit: 'xyz' })).toEqual({
      page: 1,
      limit: 20,
      offset: 0,
    })
  })

  it('never returns a page below 1 or a limit below 1', () => {
    expect(buildPaginationParams({ page: '-4', limit: '0' })).toEqual({
      page: 1,
      limit: 1,
      offset: 0,
    })
  })
})

describe('buildSearchFilter', () => {
  it('builds a case-insensitive OR across the named fields', () => {
    expect(buildSearchFilter('ada', ['firstName', 'email'])).toEqual({
      OR: [
        { firstName: { contains: 'ada', mode: 'insensitive' } },
        { email: { contains: 'ada', mode: 'insensitive' } },
      ],
    })
  })

  it('trims the search term', () => {
    const filter = buildSearchFilter('  ada  ', ['email'])
    expect(filter?.OR[0]).toEqual({ email: { contains: 'ada', mode: 'insensitive' } })
  })

  it('returns undefined for blank input, so the caller adds no filter at all', () => {
    expect(buildSearchFilter('', ['email'])).toBeUndefined()
    expect(buildSearchFilter('   ', ['email'])).toBeUndefined()
    expect(buildSearchFilter(undefined, ['email'])).toBeUndefined()
  })
})

describe('buildDateRangeFilter', () => {
  it('returns undefined when neither bound is given', () => {
    expect(buildDateRangeFilter(undefined, undefined)).toBeUndefined()
  })

  it('pushes the end date to the end of that day, so the day is included', () => {
    const filter = buildDateRangeFilter(undefined, '2026-08-05')
    expect(filter?.lte?.getHours()).toBe(23)
    expect(filter?.lte?.getMinutes()).toBe(59)
    expect(filter?.lte?.getMilliseconds()).toBe(999)
  })

  it('pulls the start date back to the start of that day', () => {
    const filter = buildDateRangeFilter('2026-08-05', undefined)
    expect(filter?.gte?.getHours()).toBe(0)
    expect(filter?.gte?.getMinutes()).toBe(0)
  })
})

describe('parseArrayParam', () => {
  it('wraps a single string value', () => {
    expect(parseArrayParam('a')).toEqual(['a'])
  })

  it('passes an array through', () => {
    expect(parseArrayParam(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('returns an empty array for anything else', () => {
    expect(parseArrayParam(undefined)).toEqual([])
    expect(parseArrayParam('')).toEqual([])
    expect(parseArrayParam(null)).toEqual([])
  })
})

describe('buildSortParams', () => {
  const allowed = ['createdAt', 'email']

  it('accepts a field on the allow-list', () => {
    expect(buildSortParams('email', 'asc', allowed, 'createdAt')).toEqual({
      field: 'email',
      direction: 'asc',
    })
  })

  // The allow-list is the whole point: without it a caller could sort by any
  // column in the table.
  it('rejects a field that is not on the allow-list and uses the fallback', () => {
    expect(buildSortParams('passwordHash', 'asc', allowed, 'createdAt').field).toBe('createdAt')
  })

  it('defaults to descending for any direction that is not exactly "asc"', () => {
    expect(buildSortParams('email', 'sideways', allowed, 'createdAt').direction).toBe('desc')
    expect(buildSortParams('email', undefined, allowed, 'createdAt').direction).toBe('desc')
  })
})
