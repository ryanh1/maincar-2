import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSetCallerName } from '@/hooks/phoneNumbers'
import type { CallerNameStatus, PhoneNumber } from '@/hooks/phoneNumbers'

const CALLER_NAME_STATUS_LABELS: Record<CallerNameStatus, string> = {
  not_requested: 'Not requested',
  pending: 'Pending carrier registration',
  active: 'Active with carrier',
  failed: 'Carrier request failed',
  unsupported: 'Not supported for this number',
}

type Props = {
  orgId: string
  number: PhoneNumber | undefined
  isPending: boolean
  isError: boolean
}

/** The name preference belongs to the primary outbound number, never the table selection. */
export function Settings_PhoneNumbers_CallerNamePreference({ orgId, number, isPending, isError }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outbound caller ID</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <p className="text-sm text-text-muted">Loading outbound caller ID.</p>
        ) : isError ? (
          <p className="text-sm text-text-muted">Could not load the outbound caller ID.</p>
        ) : number ? (
          <CallerNameForm key={number.id} orgId={orgId} number={number} />
        ) : (
          <p className="text-sm text-text-muted">
            Make a number primary before you request a caller-ID name.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function CallerNameForm({ orgId, number }: { orgId: string; number: PhoneNumber }) {
  const [callerName, setCallerName] = useState(number.callerName ?? '')
  const { mutate: setCallerNamePreference, isPending } = useSetCallerName()
  const status = number.callerNameStatus ?? 'not_requested'
  const requested = number.isCallerNameRequested ?? false
  const unsupported = status === 'unsupported'

  function save(isCallerNameRequested: boolean): void {
    setCallerNamePreference({
      orgId,
      id: number.id,
      isCallerNameRequested,
      ...(isCallerNameRequested ? { callerName: callerName.trim() } : {}),
    })
  }

  return (
    <div className="flex max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Primary outbound number</span>
        <span className="text-sm">{number.e164}</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="show-caller-id-name">Show caller-ID name</Label>
        <Switch
          id="show-caller-id-name"
          aria-label="Show caller-ID name"
          checked={requested}
          disabled={isPending || unsupported || (callerName.trim() === '' && !requested)}
          onCheckedChange={save}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="caller-id-name">Caller-ID name</Label>
        <Input
          id="caller-id-name"
          value={callerName}
          maxLength={15}
          disabled={isPending || unsupported}
          onChange={(event) => setCallerName(event.target.value)}
        />
        <p className="text-xs text-text-muted">
          Recipient display is controlled by their carrier and can take 48–72 hours after approval.
        </p>
      </div>

      <p className="text-sm text-text-muted">{CALLER_NAME_STATUS_LABELS[status]}</p>

      {number.callerNameFailureReason ? (
        <p className="text-xs text-text-muted">{number.callerNameFailureReason}</p>
      ) : unsupported ? (
        <p className="text-xs text-text-muted">This number does not support caller-ID name registration.</p>
      ) : (
        <Button
          size="sm"
          disabled={isPending || !requested || callerName.trim() === ''}
          onClick={() => save(true)}
        >
          Save caller-ID name
        </Button>
      )}
    </div>
  )
}
