import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CreateDispositionInput, DispositionResponse, DispositionsResponse, UpdateDispositionBarInput, UpdateDispositionInput } from '@/lib/dispositionTypes'
import { queryKeys } from '@/lib/queryKeys'

export function useCreateDisposition(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateDispositionInput) => jsonFetch<DispositionResponse>(`/api/orgs/${orgId}/dispositions`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.dispositions(orgId) }),
  })
}

export function useUpdateDisposition(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateDispositionInput & { id: string }) => jsonFetch<DispositionResponse>(`/api/orgs/${orgId}/dispositions/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.dispositions(orgId) }),
  })
}

export function useArchiveDisposition(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => jsonFetch<void>(`/api/orgs/${orgId}/dispositions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.dispositions(orgId) }),
  })
}

/** Publishes the complete ordered fast-bar configuration in the server transaction. */
export function useUpdateDispositionBar(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateDispositionBarInput) => jsonFetch<DispositionsResponse>(`/api/orgs/${orgId}/dispositions/bar`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.dispositions(orgId) }),
  })
}
