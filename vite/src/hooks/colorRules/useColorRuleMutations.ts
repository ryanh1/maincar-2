import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

import type { ColorRulePredicate, ColorRuleResponse, ColorRuleScope, ColorRuleTarget, ColorRulesResponse } from './types'

export type CreateColorRuleVariables = {
  orgId: string
  viewId: string
  attribute: string
  predicate: ColorRulePredicate
  target: ColorRuleTarget
  scope: ColorRuleScope
  color: string
  sortOrder: number
  enabled: boolean
}

export type UpdateColorRuleVariables = {
  orgId: string
  viewId: string
  ruleId: string
  attribute?: string
  predicate?: ColorRulePredicate
  target?: ColorRuleTarget
  scope?: ColorRuleScope
  color?: string
  sortOrder?: number
  enabled?: boolean
}

export type ReorderColorRulesVariables = { orgId: string; viewId: string; ruleIds: string[] }

function invalidate(orgId: string) {
  return { queryKey: queryKeys.colorRules.all(orgId) }
}

/** Create, edit, delete, reorder, and restore the rules of one view. */
export function useColorRuleMutations() {
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: ({ orgId, ...body }: CreateColorRuleVariables) =>
      jsonFetch<ColorRuleResponse>(`/api/orgs/${orgId}/color-rules`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries(invalidate(variables.orgId)),
  })

  const update = useMutation({
    mutationFn: ({ orgId, ruleId, ...body }: UpdateColorRuleVariables) =>
      jsonFetch<ColorRuleResponse>(`/api/orgs/${orgId}/color-rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries(invalidate(variables.orgId)),
  })

  const remove = useMutation({
    mutationFn: ({ orgId, viewId, ruleId }: { orgId: string; viewId: string; ruleId: string }) =>
      jsonFetch<void>(`/api/orgs/${orgId}/color-rules/${ruleId}?viewId=${viewId}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries(invalidate(variables.orgId)),
  })

  const reorder = useMutation({
    mutationFn: ({ orgId, ...body }: ReorderColorRulesVariables) =>
      jsonFetch<void>(`/api/orgs/${orgId}/color-rules/reorder`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries(invalidate(variables.orgId)),
  })

  const restoreDefaults = useMutation({
    mutationFn: ({ orgId, viewId }: { orgId: string; viewId: string }) =>
      jsonFetch<ColorRulesResponse>(`/api/orgs/${orgId}/color-rules/restore-defaults`, { method: 'POST', body: JSON.stringify({ viewId }) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries(invalidate(variables.orgId)),
  })

  return { create, update, remove, reorder, restoreDefaults }
}
