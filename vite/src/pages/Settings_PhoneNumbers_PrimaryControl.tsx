import { Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useSetActiveNumber } from '@/hooks/phoneNumbers'
import type { PhoneNumber } from '@/hooks/phoneNumbers'
import { ApiError } from '@/lib/api'

interface Props {
  number: PhoneNumber
  orgId: string
  ownedByViewer: boolean
}

/** The caller-ID state for one number, with changes limited to its holder. */
export function Settings_PhoneNumbers_PrimaryControl({ number, orgId, ownedByViewer }: Props) {
  const setActive = useSetActiveNumber()

  if (number.isActiveForOutbound) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Check size={16} aria-hidden />
        Primary
      </span>
    )
  }

  if (!ownedByViewer) return null

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={number.status !== 'active' || setActive.isPending}
      onClick={() =>
        setActive.mutate(
          { orgId, id: number.id },
          {
            onSuccess: () => toast.success(`${number.e164} is now primary.`),
            onError: (error) =>
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : 'Could not make this number primary. Check your connection and try again.',
              ),
          },
        )
      }
    >
      Make primary
    </Button>
  )
}
