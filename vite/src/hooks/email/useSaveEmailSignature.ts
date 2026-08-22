import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import type { EmailSignatureInput, EmailSignaturePatch, EmailSignatureResponse } from '@/lib/emailTypes'
import { queryKeys } from '@/lib/queryKeys'

export type SaveEmailSignatureVariables =
  | ({ orgId: string; signatureId?: undefined } & EmailSignatureInput)
  | ({ orgId: string; signatureId: string } & EmailSignaturePatch)

/** Create or edit a saved signature, then refresh both Settings and the picker. */
export function useSaveEmailSignature() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, signatureId, ...body }: SaveEmailSignatureVariables) => {
      const base = `/api/email/orgs/${orgId}/signatures`
      return signatureId
        ? jsonFetch<EmailSignatureResponse>(`${base}/${signatureId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : jsonFetch<EmailSignatureResponse>(base, {
            method: 'POST',
            body: JSON.stringify(body),
          })
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.signatures(variables.orgId) })
    },
  })
}
