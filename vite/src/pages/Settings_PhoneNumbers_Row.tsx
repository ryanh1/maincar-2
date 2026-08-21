import { useState } from 'react'
import { Loader2, MoreHorizontal, PhoneOff } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useReleaseNumber, useSetActiveNumber } from '@/hooks/phoneNumbers'
import type { PhoneNumber } from '@/hooks/phoneNumbers'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/datetime'
import { getPhoneNumberStatusLabel } from '@/lib/phoneNumberLabels'

interface Props {
  number: PhoneNumber
  orgId: string
  /**
   * Whether the caller holds another dialable number besides this one. It decides
   * both halves of the release rule: with a fallback the server refuses to release
   * the caller ID, and without one it allows it and the confirm states what that
   * costs.
   */
  hasOtherActiveNumber: boolean
  timeZone: string | null | undefined
}

/** One row of the phone numbers table: the number, its status, the caller-ID radio, and its actions. */
export function Settings_PhoneNumbers_Row({
  number,
  orgId,
  hasOtherActiveNumber,
  timeZone,
}: Props) {
  const setActive = useSetActiveNumber()
  const releaseNumber = useReleaseNumber()
  const [confirmRelease, setConfirmRelease] = useState(false)

  const isActive = number.isActiveForOutbound
  // Only a dialable number that is not already the caller ID can be picked.
  // `searching`, `releasing`, and `failed` cannot call out.
  const canActivate = number.status === 'active' && !isActive

  // The server refuses both of these. The menu anticipates them and says why in
  // the item's own label, because a greyed row with no reason is a dead end.
  const isBuying = number.status === 'searching'
  const isReleasing = number.status === 'releasing'
  const needsAnotherCallerId = isActive && hasOtherActiveNumber
  const canRelease = !isBuying && !isReleasing && !needsAnotherCallerId

  // Stated only when it is true: this is the caller ID AND there is nothing to
  // fall back on, which is the one case the server lets through.
  const losesCallerId = isActive && !hasOtherActiveNumber

  function release(): void {
    releaseNumber.mutate(
      { orgId, id: number.id },
      {
        onSuccess: () => {
          setConfirmRelease(false)
          toast.success(`Releasing ${number.e164}.`)
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : 'Could not release the number. Try again.',
          ),
      },
    )
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-1 text-sm tabular-nums">{number.e164}</td>
      <td className="px-3 py-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          {/* Read as "still in progress" rather than a bare status word — the
              word alone left a reader unsure whether the screen was stuck. */}
          {isBuying && (
            <Loader2 size={14} aria-hidden className="animate-spin text-muted-foreground" />
          )}
          {getPhoneNumberStatusLabel(number)}
        </span>
      </td>
      <td className="px-3 py-1 text-sm tabular-nums text-muted-foreground">
        {formatDate(number.createdAt, timeZone)}
      </td>
      <td className="px-3 py-1 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="caller-id"
            className="size-4 accent-primary"
            checked={isActive}
            disabled={!canActivate || setActive.isPending}
            onChange={() =>
              setActive.mutate(
                { orgId, id: number.id },
                {
                  onSuccess: () => toast.success('Caller ID updated.'),
                  onError: (error) =>
                    toast.error(
                      error instanceof ApiError
                        ? error.message
                        : 'Could not update the caller ID. Try again.',
                    ),
                },
              )
            }
            aria-label={`Set ${number.e164} as caller ID`}
          />
          <span className={isActive ? 'text-foreground' : 'text-muted-foreground'}>
            {isActive ? 'Caller ID' : 'Set as caller ID'}
          </span>
        </label>
      </td>
      <td className="px-2 py-1 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton tooltip={`Show actions for ${number.e164}`}>
              <MoreHorizontal size={16} aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={!canRelease}
              onSelect={() => setConfirmRelease(true)}
            >
              <PhoneOff size={16} aria-hidden />
              {isBuying
                ? 'Wait until it is ready'
                : isReleasing
                  ? 'Already releasing'
                  : needsAnotherCallerId
                    ? 'Set another caller ID first'
                    : 'Release this number'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={confirmRelease} onOpenChange={setConfirmRelease}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Release {number.e164}?</AlertDialogTitle>
              {/* The specific consequence, not "Are you sure?". The last line is
                  the one the server declines to enforce: it lets a rep give up
                  their final number rather than rent it forever, so the cost of
                  doing that has to be stated here, where it can be read. */}
              <AlertDialogDescription>
                Twilio takes this number back and the monthly charge stops. You cannot get this
                number again.
                {losesCallerId && ' You cannot place calls until you buy another number.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={releaseNumber.isPending}
                onClick={(event) => {
                  // Hold the dialog open until the server answers, so a refused
                  // release reports its reason instead of vanishing.
                  event.preventDefault()
                  release()
                }}
              >
                {releaseNumber.isPending ? 'Releasing…' : 'Release'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  )
}
