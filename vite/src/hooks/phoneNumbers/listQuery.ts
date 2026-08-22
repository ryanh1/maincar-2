import type { GetPhoneNumbersParams } from '@/lib/phoneNumberTypes'

/** The optional query string shared by the caller and organization Numbers tables. */
export function buildPhoneNumbersListQuery(params: GetPhoneNumbersParams): string {
  const search = new URLSearchParams()
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  if (params.sort) search.set('sort', params.sort)
  if (params.dir) search.set('dir', params.dir)
  if (params.q) search.set('q', params.q)
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}
