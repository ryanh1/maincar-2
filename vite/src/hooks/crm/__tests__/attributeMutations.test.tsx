import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useCreateAttribute } from '../useCreateAttribute'
import { useDeleteAttribute } from '../useDeleteAttribute'
import { useReorderAttributes } from '../useReorderAttributes'
import { useUpdateAttribute } from '../useUpdateAttribute'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch: vi.fn() }
})

function setup<T>(hook: () => T) {
  const client = makeTestQueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { ...renderHook(hook, { wrapper }), invalidate }
}

async function expectSchemaInvalidations(invalidate: ReturnType<typeof vi.spyOn>, orgId: string) {
  await waitFor(() => {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.objects.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.crm.objects(orgId) })
  })
}

describe('attribute mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a custom field and refreshes editor and navbar object queries', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ attribute: { id: 'attr-renewal' } } as never)
    const { result, invalidate } = setup(() => useCreateAttribute())

    await result.current.mutateAsync({
      orgId: 'org-1',
      objectId: 'obj-company',
      slug: 'renewal_month',
      name: 'Renewal month',
      type: 'date',
      isRequired: true,
    })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/attributes', {
      method: 'POST',
      body: JSON.stringify({
        objectId: 'obj-company',
        slug: 'renewal_month',
        name: 'Renewal month',
        type: 'date',
        isRequired: true,
      }),
    })
    await expectSchemaInvalidations(invalidate, 'org-1')
  })

  it('patches only submitted field settings and refreshes editor and navbar object queries', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ attribute: { id: 'attr-contacts' } } as never)
    const { result, invalidate } = setup(() => useUpdateAttribute())

    await result.current.mutateAsync({
      orgId: 'org-1',
      objectId: 'obj-company',
      attributeId: 'attr-contacts',
      isMulti: false,
      resolveMultiToSingle: true,
    })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/attributes/attr-contacts', {
      method: 'PATCH',
      body: JSON.stringify({ isMulti: false, resolveMultiToSingle: true }),
    })
    await expectSchemaInvalidations(invalidate, 'org-1')
  })

  it('reorders fields through their patch routes and refreshes editor and navbar object queries', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ attribute: {} } as never)
    const { result, invalidate } = setup(() => useReorderAttributes())

    await result.current.mutateAsync({
      orgId: 'org-1',
      objectId: 'obj-company',
      attributeIds: ['attr-name', 'attr-domain'],
    })

    expect(jsonFetch).toHaveBeenNthCalledWith(1, '/api/orgs/org-1/attributes/attr-name', {
      method: 'PATCH',
      body: JSON.stringify({ sortOrder: 0 }),
    })
    expect(jsonFetch).toHaveBeenNthCalledWith(2, '/api/orgs/org-1/attributes/attr-domain', {
      method: 'PATCH',
      body: JSON.stringify({ sortOrder: 1 }),
    })
    await expectSchemaInvalidations(invalidate, 'org-1')
  })

  it('refreshes schema queries when a reorder only partially succeeds', async () => {
    vi.mocked(jsonFetch)
      .mockResolvedValueOnce({ attribute: {} } as never)
      .mockRejectedValueOnce(new Error('Could not reorder the field.'))
    const { result, invalidate } = setup(() => useReorderAttributes())

    await expect(result.current.mutateAsync({
      orgId: 'org-1',
      objectId: 'obj-company',
      attributeIds: ['attr-name', 'attr-domain'],
    })).rejects.toThrow('Could not reorder the field.')

    await expectSchemaInvalidations(invalidate, 'org-1')
  })

  it('deletes a custom field and refreshes editor and navbar object queries', async () => {
    vi.mocked(jsonFetch).mockResolvedValue(undefined as never)
    const { result, invalidate } = setup(() => useDeleteAttribute())

    await result.current.mutateAsync({
      orgId: 'org-1',
      objectId: 'obj-company',
      attributeId: 'attr-renewal',
    })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/attributes/attr-renewal', { method: 'DELETE' })
    await expectSchemaInvalidations(invalidate, 'org-1')
  })
})
