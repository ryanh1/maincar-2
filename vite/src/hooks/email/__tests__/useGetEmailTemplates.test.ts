import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { EmailTemplate, EmailTemplateListQuery } from '@/lib/emailTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetEmailTemplates } from '../useGetEmailTemplates'

// Only the transport is mocked. The hook's job is the URL, the key, and the
// enabled gate, so a real fetch would only add a network to the assertions.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function template(id: string, name: string, createdById: string | null = 'user-1'): EmailTemplate {
  return {
    id,
    name,
    subject: 'Following up',
    bodyHtml: '<p>Hi there</p>',
    visibility: 'PRIVATE',
    createdById,
    fieldsJson: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderGetTemplates(
  orgId: string | null | undefined,
  query?: EmailTemplateListQuery,
  client: QueryClient = makeTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetEmailTemplates(orgId, query), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetEmailTemplates', () => {
  it('serializes the server query contract and returns its paged response', async () => {
    const templates = [template('tpl-a', 'Discovery follow-up'), template('tpl-b', 'Quote sent')]
    jsonFetch.mockResolvedValue({ templates, total: 32, page: 2, limit: 10 })

    const { result } = renderGetTemplates('org-1', {
      scope: 'private',
      page: 2,
      limit: 10,
      sort: 'author',
      dir: 'desc',
      q: 'follow up',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith(
      '/api/email/orgs/org-1/templates?scope=private&page=2&limit=10&sort=author&dir=desc&q=follow+up',
    )
    expect(result.current.data).toMatchObject({ total: 32, page: 2, limit: 10 })
    expect(result.current.data?.templates.map((t) => t.name)).toEqual([
      'Discovery follow-up',
      'Quote sent',
    ])
  })

  it('reads templates written by a rep who has left, rather than treating them as broken', async () => {
    // createdById is attribution, never a filter. A null means the author left
    // the org and the template outlived them, which is the point of an
    // org-shared template.
    jsonFetch.mockResolvedValue({ templates: [template('tpl-a', 'Orphaned', null)], total: 1 })

    const { result } = renderGetTemplates('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.templates[0].createdById).toBeNull()
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetTemplates(null)

    // 'idle' is the disabled state: pending with nothing in flight. Without the
    // gate this would request /api/email/orgs/null/templates.
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('does not fire while the org is still undefined', () => {
    const { result } = renderGetTemplates(undefined)

    expect(result.current.fetchStatus).toBe('idle')
    expect(jsonFetch).not.toHaveBeenCalled()
  })

  it('caches under the centralized key, so a write invalidation reaches it', async () => {
    jsonFetch.mockResolvedValue({ templates: [template('tpl-a', 'Quote sent')], total: 1, page: 1, limit: 25 })

    const { client, result } = renderGetTemplates('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.email.templates('org-1'))).toEqual({
      templates: [template('tpl-a', 'Quote sent')],
      total: 1,
      page: 1,
      limit: 25,
    })
  })

  it('keys separately from drafts, so one invalidation does not stand in for the other', async () => {
    jsonFetch.mockResolvedValue({ templates: [], total: 0, page: 1, limit: 25 })

    const { client, result } = renderGetTemplates('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.email.drafts('org-1'))).toBeUndefined()
  })

  it('keys by org, so switching organizations does not show the previous one templates', async () => {
    jsonFetch.mockResolvedValue({ templates: [template('tpl-a', 'Ours')], total: 1, page: 1, limit: 25 })
    const client = makeTestQueryClient()

    const first = renderGetTemplates('org-1', undefined, client)
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))

    jsonFetch.mockResolvedValue({ templates: [template('tpl-z', 'Theirs')], total: 1, page: 1, limit: 25 })
    const second = renderGetTemplates('org-2', undefined, client)
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))

    expect(jsonFetch).toHaveBeenNthCalledWith(2, '/api/email/orgs/org-2/templates')
    expect(client.getQueryData(queryKeys.email.templates('org-1'))).toBeDefined()
    expect(second.result.current.data?.templates[0].id).toBe('tpl-z')
  })

  it('never reuses private results for the organization scope', async () => {
    const client = makeTestQueryClient()
    jsonFetch.mockResolvedValue({ templates: [template('tpl-private', 'Only mine')], total: 1, page: 1, limit: 25 })

    const privateTemplates = renderGetTemplates('org-1', { scope: 'private' }, client)
    await waitFor(() => expect(privateTemplates.result.current.isSuccess).toBe(true))

    jsonFetch.mockResolvedValue({
      templates: [template('tpl-organization', 'Shared')],
      total: 1,
      page: 1,
      limit: 25,
    })
    const organizationTemplates = renderGetTemplates('org-1', { scope: 'organization' }, client)
    await waitFor(() => expect(organizationTemplates.result.current.isSuccess).toBe(true))

    expect(jsonFetch).toHaveBeenNthCalledWith(1, '/api/email/orgs/org-1/templates?scope=private')
    expect(jsonFetch).toHaveBeenNthCalledWith(2, '/api/email/orgs/org-1/templates?scope=organization')
    expect(privateTemplates.result.current.data?.templates[0].id).toBe('tpl-private')
    expect(organizationTemplates.result.current.data?.templates[0].id).toBe('tpl-organization')
  })

  it('keeps the previous page visible while the next page is loading', async () => {
    const client = makeTestQueryClient()
    jsonFetch.mockResolvedValueOnce({
      templates: [template('tpl-page-1', 'First page')],
      total: 2,
      page: 1,
      limit: 1,
    })
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
    const { result, rerender } = renderHook(
      ({ query }: { query: EmailTemplateListQuery }) => useGetEmailTemplates('org-1', query),
      { initialProps: { query: { page: 1, limit: 1 } }, wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    let finishNextPage: (value: unknown) => void = () => undefined
    jsonFetch.mockImplementationOnce(
      () => new Promise((resolve) => { finishNextPage = resolve }),
    )
    rerender({ query: { page: 2, limit: 1 } })

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true))
    expect(result.current.data?.templates[0].id).toBe('tpl-page-1')

    finishNextPage({ templates: [template('tpl-page-2', 'Second page')], total: 2, page: 2, limit: 1 })
    await waitFor(() => expect(result.current.data?.templates[0].id).toBe('tpl-page-2'))
  })

  it('surfaces the server own message when the read fails', async () => {
    jsonFetch.mockRejectedValue(new ApiError('You are not a member of this organization.', 403))

    const { result } = renderGetTemplates('org-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'You are not a member of this organization.',
    )
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
