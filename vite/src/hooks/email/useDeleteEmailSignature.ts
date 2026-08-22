import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, jsonFetch } from '@/lib/api'
import type { DeleteEmailSignatureResponse } from '@/lib/emailTypes'
import { queryKeys } from '@/lib/queryKeys'

export interface DeleteEmailSignatureVariables {
  orgId: string
  signatureId: string
}

/** Deletes one of the signed-in rep's signatures. A concurrent delete is already successful. */
export function useDeleteEmailSignature() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, signatureId }: DeleteEmailSignatureVariables) => {
      try {
        return await jsonFetch<DeleteEmailSignatureResponse>(
          `/api/email/orgs/${orgId}/signatures/${signatureId}`,
          { method: 'DELETE' },
        )
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return { signature: { id: signatureId } }
        throw error
      }
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.signatures(variables.orgId) })
    },
  })
}
