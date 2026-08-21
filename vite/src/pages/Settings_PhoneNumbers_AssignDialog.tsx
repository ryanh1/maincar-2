import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import { useAssignNumber } from '@/hooks/phoneNumbers'
import type { OrgPhoneNumber } from '@/hooks/phoneNumbers'
import { ApiError } from '@/lib/api'

// One call gets every member a picker could need — the members route serves up
// to 200 in one page precisely so a picker never has to page (memberQuery.ts).
const MEMBER_PICKER_LIMIT = 200

interface Props {
  orgId: string
  number: OrgPhoneNumber
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Give a number to a member, or hand it from its current holder to someone else.
 *
 * One dialog covers assign and reassign — they are the same write server-side,
 * and the only difference on screen is the sentence naming who has it now.
 */
export function Settings_PhoneNumbers_AssignDialog({ orgId, number, open, onOpenChange }: Props) {
  const [userId, setUserId] = useState<string | null>(null)
  const membersQuery = useGetMembers(orgId, { limit: MEMBER_PICKER_LIMIT, sort: 'name' })
  const assign = useAssignNumber()

  const members = membersQuery.data?.members ?? []
  const isReassign = number.assignedUser !== null

  function onSubmit() {
    if (!userId) return
    assign.mutate(
      { orgId, id: number.id, userId },
      {
        onSuccess: (data) => {
          onOpenChange(false)
          setUserId(null)
          toast.success(`${number.e164} now belongs to ${memberOrEmail(data.number.assignedUser)}.`)
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : 'Could not assign this number. Try again.',
          ),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isReassign ? 'Reassign' : 'Assign'} {number.e164}</DialogTitle>
          <DialogDescription>
            {isReassign
              ? `Currently held by ${memberOrEmail(number.assignedUser)}. Picking a new member takes it from them and clears their caller ID.`
              : 'Nobody holds this number yet.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-member">Member</Label>
          {membersQuery.isPending ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <Select value={userId ?? undefined} onValueChange={setUserId}>
              <SelectTrigger id="assign-member" className="h-8 w-full">
                <SelectValue placeholder="Pick a member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {memberDisplayName(member)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!userId || assign.isPending}>
            {assign.isPending ? 'Assigning…' : isReassign ? 'Reassign' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function memberOrEmail(assignee: { firstName: string | null; lastName: string | null; email: string } | null): string {
  if (!assignee) return 'nobody'
  const name = [assignee.firstName, assignee.lastName].filter(Boolean).join(' ')
  return name || assignee.email
}
