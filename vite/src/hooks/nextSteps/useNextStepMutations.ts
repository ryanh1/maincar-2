import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { CreateNextStepTypeInput, NextStepTypeResponse, NextStepTypesResponse, SaveDispositionNextStepRuleInput, UpdateNextStepBarInput, UpdateNextStepTypeInput } from '@/lib/nextStepTypes'
import { queryKeys } from '@/lib/queryKeys'

function invalidateNextSteps(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.nextSteps.all(orgId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dispositions(orgId) }),
  ])
}

export function useCreateNextStepType(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateNextStepTypeInput) => jsonFetch<NextStepTypeResponse>(`/api/orgs/${orgId}/next-steps/types`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateNextSteps(queryClient, orgId),
  })
}

export function useUpdateNextStepType(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateNextStepTypeInput & { id: string }) => jsonFetch<NextStepTypeResponse>(`/api/orgs/${orgId}/next-steps/types/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => invalidateNextSteps(queryClient, orgId),
  })
}

export function useUpdateNextStepBar(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNextStepBarInput) => jsonFetch<NextStepTypesResponse>(`/api/orgs/${orgId}/next-steps/types/bar`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => invalidateNextSteps(queryClient, orgId),
  })
}

export function useSaveDispositionNextStepRule(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ dispositionId, nextStepTypeId }: SaveDispositionNextStepRuleInput) => jsonFetch(`/api/orgs/${orgId}/next-steps/rules/${dispositionId}`, { method: 'PUT', body: JSON.stringify({ nextStepTypeId }) }),
    onSuccess: () => invalidateNextSteps(queryClient, orgId),
  })
}
