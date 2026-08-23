import { useQuery } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { KeyboardBinding } from '@/components/keyboard/keyboardRegistry'

export interface KeyboardBindingsResponse {
  bindings: KeyboardBinding[]
}

export function useGetKeyboardBindings() {
  return useQuery({
    queryKey: queryKeys.keyboardBindings,
    queryFn: () => jsonFetch<KeyboardBindingsResponse>('/api/keyboard-bindings'),
  })
}
