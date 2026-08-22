import { ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'

import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useGetRecordingPolicy, useUpdateRecordingPolicy } from '@/hooks/recordingPolicy'
import type { RecordingPolicyPatch } from '@/lib/recordingPolicyTypes'
import { useAuth } from '@/providers/useAuth'

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
  ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['DC', 'District of Columbia'],
] as const

const STATE_NAMES = new Map(US_STATES)
type StateCode = (typeof US_STATES)[number][0]

function SettingRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border py-4 last:border-b-0">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function Settings_CallRecordingsTab() {
  const { org, isAdmin } = useAuth()
  const policyQuery = useGetRecordingPolicy(org?.id)
  const updatePolicy = useUpdateRecordingPolicy(org?.id ?? '')

  if (!org) return null
  if (policyQuery.isError) return <p className="text-sm text-destructive">Could not load call recordings. Refresh and try again.</p>
  if (policyQuery.isLoading || !policyQuery.data) return <p className="text-sm text-text-muted">Loading call recordings.</p>

  const policy = policyQuery.data.recordingPolicy
  const disabled = !isAdmin || updatePolicy.isPending

  async function save(patch: RecordingPolicyPatch) {
    try {
      await updatePolicy.mutateAsync(patch)
      toast.success('Call recording policy saved.')
    } catch {
      toast.error('Could not save call recording policy. Try again.')
    }
  }

  function toggleState(state: StateCode) {
    const allowedStates = policy.allowedStates.includes(state)
      ? policy.allowedStates.filter((value) => value !== state)
      : [...policy.allowedStates, state].sort()
    void save({ allowedStates })
  }

  return (
    <section className="max-w-2xl">
      <h2 className="text-sm font-semibold">Call recordings</h2>
      <p className="mt-1 text-xs text-text-muted">This policy applies to every new outbound call in the organization.</p>

      <div className="mt-4 border border-border bg-bg px-4">
        <SettingRow
          id="record-calls"
          label="Record calls"
          description="Record outbound calls when the safeguards below allow it."
          checked={policy.recordCalls}
          disabled={disabled}
          onCheckedChange={(recordCalls) => void save({ recordCalls })}
        />
        <SettingRow
          id="block-two-party-states"
          label="Do not record in two-party-consent states"
          description="Do not record when the destination area code indicates a two-party-consent state. Unknown destinations are not recorded too."
          checked={policy.blockTwoPartyConsentStates}
          disabled={disabled || !policy.recordCalls}
          onCheckedChange={(blockTwoPartyConsentStates) => void save({ blockTwoPartyConsentStates })}
        />
        <div className="py-4">
          <Label>States to record</Label>
          <p className="mt-1 text-xs text-text-muted">Leave empty to record every state allowed by the settings above.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {policy.allowedStates.map((state) => (
              <span key={state} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-xs">
                {state}
                <IconButton
                  type="button"
                  tooltip={`Remove ${STATE_NAMES.get(state as StateCode) ?? state} from allowed states`}
                  onClick={() => toggleState(state as StateCode)}
                  disabled={disabled}
                  className="size-4"
                >
                  <X size={12} aria-hidden="true" />
                </IconButton>
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="sm" disabled={disabled}>
                  Select states <ChevronDown size={16} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-56">
                {US_STATES.map(([code, name]) => (
                  <DropdownMenuCheckboxItem key={code} checked={policy.allowedStates.includes(code)} onCheckedChange={() => toggleState(code)}>
                    {name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {policy.allowedStates.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => void save({ allowedStates: [] })}>
                Clear states
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {!isAdmin ? <p className="mt-3 text-xs text-text-muted">Only an admin can change this policy.</p> : null}
    </section>
  )
}
