import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { SelectedValuesPicker } from '@/components/ui/selected-values-picker'
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

const TWO_PARTY_CONSENT_STATES = ['CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NV', 'NH', 'OR', 'PA', 'WA']
const BLOCKED_STATE_OPTIONS = [
  { value: 'UNKNOWN', label: 'Unknown destination state' },
  ...US_STATES.map(([value, label]) => ({ value, label })),
]

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

  return (
    <section className="max-w-2xl">
      <h2 className="text-sm font-semibold">Call recordings</h2>
      <p className="mt-1 text-xs text-text-muted">This policy applies to every new outbound call in the organization.</p>

      <div className="mt-4 border border-border bg-bg px-4">
        <SettingRow
          id="record-calls"
          label="Record calls"
          description="Record outbound calls unless the blocked state set prevents it."
          checked={policy.recordCalls}
          disabled={disabled}
          onCheckedChange={(recordCalls) => void save({ recordCalls })}
        />
        <div className="py-4">
          <Label>Do not record in the following states</Label>
          <p className="mt-1 text-xs text-text-muted">Select states and Unknown to prevent recording when the destination matches.</p>
          <div className="mt-3">
            <SelectedValuesPicker
              label="Select states"
              options={BLOCKED_STATE_OPTIONS}
              value={policy.blockedStates}
              disabled={disabled || !policy.recordCalls}
              presets={[{ label: 'Two-party consent states', values: TWO_PARTY_CONSENT_STATES }]}
              onValueChange={(blockedStates) => void save({ blockedStates })}
            />
          </div>
        </div>
      </div>
      {!isAdmin ? <p className="mt-3 text-xs text-text-muted">Only an admin can change this policy.</p> : null}
    </section>
  )
}
