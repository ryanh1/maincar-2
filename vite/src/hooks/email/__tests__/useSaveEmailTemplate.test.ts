import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { EmailTemplate } from '@/lib/emailTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useSaveEmailTemplate } from '../useSaveEmailTemplate'

// Only the transport is mocked. The hook's job is picking POST vs PATCH, the
// URL, the body it sends, and what it does to the cache afterwards.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function template(id: string, name: string): EmailTemplate {
  return {
    id,
    name,
    subject: 'Following up',
    bodyHtml: '<p>Hi there</p>',
    visibility: 'PRIVATE',
    createdById: 'user-1',
    fieldsJson: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderSaveTemplate(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useSaveEmailTemplate(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useSaveEmailTemplate', () => {
  it('POSTs to the collection when there is no id yet', async () => {
    jsonFetch.mockResolvedValue({ template: template('tpl-1', 'Quote sent') })

    const { result } = renderSaveTemplate()
    result.current.mutate({
      orgId: 'org-1',
      name: 'Quote sent',
      subject: 'Your quote',
      bodyHtml: '<p>Hi there</p>',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch.mock.calls[0][0]).toBe('/api/email/orgs/org-1/templates')
    expect(jsonFetch.mock.calls[0][1].method).toBe('POST')
    expect(result.current.data?.template.id).toBe('tpl-1')
  })

  it('PATCHes the row when an id is passed, and never sends orgId or templateId in the body', async () => {
    jsonFetch.mockResolvedValue({ template: template('tpl-1', 'Renamed') })

    const { result } = renderSaveTemplate()
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1', name: 'Renamed' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch.mock.calls[0][0]).toBe('/api/email/orgs/org-1/templates/tpl-1')
    expect(jsonFetch.mock.calls[0][1].method).toBe('PATCH')
    // Both name the row in the PATH. Repeating them in the body would put keys
    // the server does not read somewhere they could drift.
    expect(JSON.parse(jsonFetch.mock.calls[0][1].body)).toEqual({ name: 'Renamed' })
  })

  it('sends only the keys the caller changed, so renaming does not blank the body', async () => {
    jsonFetch.mockResolvedValue({ template: template('tpl-1', 'Renamed') })

    const { result } = renderSaveTemplate()
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1', subject: 'New subject' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The route writes exactly the keys the body carries. An absent bodyHtml is
    // an untouched body, not an empty one.
    expect(JSON.parse(jsonFetch.mock.calls[0][1].body)).toEqual({ subject: 'New subject' })
  })

  it('serializes an explicit visibility on create and edit saves', async () => {
    jsonFetch.mockResolvedValue({ template: template('tpl-1', 'Quote sent') })

    const { result } = renderSaveTemplate()
    result.current.mutate({ orgId: 'org-1', name: 'Quote sent', visibility: 'PRIVATE' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(JSON.parse(jsonFetch.mock.calls[0][1].body)).toEqual({
      name: 'Quote sent',
      visibility: 'PRIVATE',
    })

    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-1', visibility: 'ORGANIZATION' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(JSON.parse(jsonFetch.mock.calls[1][1].body)).toEqual({ visibility: 'ORGANIZATION' })
  })

  it('invalidates the org templates list after a save, unlike the draft hooks', async () => {
    jsonFetch.mockResolvedValue({ template: template('tpl-1', 'Quote sent') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderSaveTemplate(client)
    result.current.mutate({ orgId: 'org-1', name: 'Quote sent' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // useUpdateEmailDraft must NOT invalidate, because a card owns its own text
    // while it is open and a refetch would reset the caret mid-sentence. Nothing
    // holds a caret over a template list: the form saves and closes, and the
    // list behind it is org-shared, so a teammate's save is a change this client
    // could not have applied by hand.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.email.templates('org-1') })
  })

  it('leaves the drafts cache alone', async () => {
    jsonFetch.mockResolvedValue({ template: template('tpl-1', 'Quote sent') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderSaveTemplate(client)
    result.current.mutate({ orgId: 'org-1', name: 'Quote sent' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.email.drafts('org-1') })
  })

  it('does not invalidate when the save failed', async () => {
    jsonFetch.mockRejectedValue(new ApiError('A template needs a name.', 400))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderSaveTemplate(client)
    result.current.mutate({ orgId: 'org-1', name: '   ' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // Nothing was written, so there is nothing to reread — and the form stays
    // open showing what the rep typed.
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('surfaces the server own validation sentence', async () => {
    jsonFetch.mockRejectedValue(new ApiError('A template needs a name.', 400))

    const { result } = renderSaveTemplate()
    result.current.mutate({ orgId: 'org-1', name: '   ' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe('A template needs a name.')
    expect((result.current.error as ApiError).status).toBe(400)
  })

  it('surfaces the 404 when a teammate deleted the template while the form was open', async () => {
    // Templates are org-shared, so this is a real race, not a same-rep-two-tabs
    // curiosity. An edit against a row that is gone is a genuine error — unlike
    // a DELETE against one, which got what it asked for.
    jsonFetch.mockRejectedValue(new ApiError('Template not found', 404))

    const { result } = renderSaveTemplate()
    result.current.mutate({ orgId: 'org-1', templateId: 'tpl-gone', name: 'Renamed' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe('Template not found')
    expect((result.current.error as ApiError).status).toBe(404)
  })
})
