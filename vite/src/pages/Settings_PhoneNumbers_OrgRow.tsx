import { useState } from 'react'
import { MoreHorizontal, UserMinus, UserPlus } from 'lucide-react'
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
import { useAssignNumber } from '@/hooks/phoneNumbers'
import type { OrgPhoneNumber } from '@/hooks/phoneNumbers'
import { formatDate } from '@/lib/datetime'
import { ApiError } from '@/lib/api'
import { getPhoneNumberStatusLabel } from '@/lib/phoneNumberLabels'

import { Settings_PhoneNumbers_AssignDialog } from './Settings_PhoneNumbers_AssignDialog'
import { Settings_PhoneNumbers_PrimaryControl } from './Settings_PhoneNumbers_PrimaryControl'

interface Props {
  orgId: string
  number: OrgPhoneNumber
  timeZone: string | null | undefined
  viewerId: string | null | undefined
}

/** The holder's display name, or the email when they have none set. */
function holderName(assignee: OrgPhoneNumber['assignedUser']): string {
  if (!assignee) return ''
  const name = [assignee.firstName, assignee.lastName].filter(Boolean).join(' ')
  return name || assignee.email
}

/** One row of the org-wide phone number inventory: the number, its holder, and what an admin can do. */
export function Settings_PhoneNumbers_OrgRow({ orgId, number, timeZone, viewerId }: Props) {
  const [assignOpen, setAssignOpen] = useState(false)
  const [confirmUnassign, setConfirmUnassign] = useState(false)
  const unassign = useAssignNumber()

  const holder = number.assignedUser

  function onUnassign() {
    unassign.mutate(
      { orgId, id: number.id, userId: null },
      {
        onSuccess: () => {
          setConfirmUnassign(false)
          toast.success(`${number.e164} is back with the organization.`)
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : 'Could not take back this number. Try again.',
          ),
      },
    )
  }

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 text-sm tabular-nums">{number.e164}</td>
      <td className="px-4 py-2 text-sm">
        {holder ? (
          <span className="flex flex-col">
            <span className="truncate">{holderName(holder)}</span>
            <span className="truncate text-xs text-muted-foreground">{holder.email}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-2 text-sm">{getPhoneNumberStatusLabel(number)}</td>
      <td className="px-4 py-2 text-sm tabular-nums text-muted-foreground">
        {formatDate(number.createdAt, timeZone)}
      </td>
      <td className="px-4 py-1 text-sm">
        <Settings_PhoneNumbers_PrimaryControl
          number={number}
          orgId={orgId}
          ownedByViewer={number.assignedUser?.id === viewerId}
        />
      </td>
      <td className="px-2 py-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton tooltip={`Show actions for ${number.e164}`}>
              <MoreHorizontal size={16} aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setAssignOpen(true)}>
              <UserPlus size={16} aria-hidden />
              {holder ? 'Reassign to another member' : 'Assign to a member'}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!holder}
              onSelect={() => setConfirmUnassign(true)}
            >
              <UserMinus size={16} aria-hidden />
              Take back this number
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>

      <Settings_PhoneNumbers_AssignDialog
        orgId={orgId}
        number={number}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />

      <AlertDialog open={confirmUnassign} onOpenChange={setConfirmUnassign}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take back {number.e164}?</AlertDialogTitle>
            <AlertDialogDescription>
              {holder ? holderName(holder) : 'The current holder'} can no longer call from this number.
              The organization keeps paying for the number until someone else gets it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={unassign.isPending}
              onClick={(event) => {
                event.preventDefault()
                onUnassign()
              }}
            >
              {unassign.isPending ? 'Taking back…' : 'Take back'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </tr>
  )
}
