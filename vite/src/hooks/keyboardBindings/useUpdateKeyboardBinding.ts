import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { KeyboardBinding } from '@/components/keyboard/keyboardRegistry'

import type { KeyboardBindingsResponse } from './useGetKeyboardBindings'

interface UpdateKeyboardBindingVariables {
  actionId: string
  keys: string
}

export function useUpdateKeyboardBinding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ actionId, keys }: UpdateKeyboardBindingVariables) =>
      jsonFetch<{ binding: KeyboardBinding }>(`/api/keyboard-bindings/${actionId}`, {
        method: 'PUT',
        body: JSON.stringify({ keys }),
      }),
    onSuccess: ({ binding }) => {
      queryClient.setQueryData<KeyboardBindingsResponse>(queryKeys.keyboardBindings, (previous) => ({
        bindings: [...(previous?.bindings ?? []).filter((item) => item.actionId !== binding.actionId), binding],
      }))
    },
  })
}
