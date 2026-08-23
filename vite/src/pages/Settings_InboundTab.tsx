import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useGetInboundForwarding, useUpdateInboundForwarding } from '@/hooks/inboundForwarding'
import type { InboundForwarding, InboundForwardingStrategy } from '@/lib/inboundForwardingTypes'
import { useAuth } from '@/providers/useAuth'

export function Settings_InboundTab() {
  const { org } = useAuth()
  const forwardingQuery = useGetInboundForwarding(org?.id)
  const updateForwarding = useUpdateInboundForwarding(org?.id ?? '')

  if (!org) return null
  if (forwardingQuery.isError) return <p className="text-sm text-destructive">Could not load inbound forwarding. Refresh and try again.</p>
  if (forwardingQuery.isLoading || !forwardingQuery.data) return <p className="text-sm text-text-muted">Loading inbound forwarding.</p>

  return (
    <InboundForwardingForm
      key={`${org.id}:${forwardingQuery.data.inboundForwarding.enabled}:${forwardingQuery.data.inboundForwarding.mobileE164}:${forwardingQuery.data.inboundForwarding.strategy}`}
      forwarding={forwardingQuery.data.inboundForwarding}
      isPending={updateForwarding.isPending}
      onSave={updateForwarding.mutateAsync}
    />
  )
}

function InboundForwardingForm({
  forwarding,
  isPending,
  onSave,
}: {
  forwarding: InboundForwarding
  isPending: boolean
  onSave: (forwarding: InboundForwarding) => Promise<unknown>
}) {
  const [enabled, setEnabled] = useState(forwarding.enabled)
  const [mobileE164, setMobileE164] = useState(forwarding.mobileE164 ?? '')
  const [strategy, setStrategy] = useState<InboundForwardingStrategy>(forwarding.strategy)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await onSave({ enabled, mobileE164: mobileE164.trim() || null, strategy })
      toast.success('Inbound forwarding saved.')
    } catch {
      toast.error('Could not save inbound forwarding. Check the mobile number and try again.')
    }
  }

  const disabled = isPending

  return (
    <section className="max-w-2xl">
      <h2 className="text-sm font-semibold">Inbound calls</h2>
      <p className="mt-1 text-xs text-text-muted">Choose how calls to your assigned business number reach you.</p>

      <form onSubmit={onSubmit} className="mt-4 border border-border bg-bg px-4">
        <div className="flex items-start justify-between gap-6 border-b border-border py-4">
          <div className="space-y-1">
            <Label htmlFor="forward-inbound-to-mobile">Forward inbound calls to mobile</Label>
            <p className="text-xs text-text-muted">A caller hears ringing until your browser or mobile connects.</p>
          </div>
          <Switch
            id="forward-inbound-to-mobile"
            checked={enabled}
            disabled={disabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inbound-mobile-number">Mobile number</Label>
            <Input
              id="inbound-mobile-number"
              autoComplete="tel"
              disabled={disabled}
              inputMode="tel"
              placeholder="+12025550188"
              value={mobileE164}
              onChange={(event) => setMobileE164(event.target.value)}
            />
            <p className="text-xs text-text-muted">Use E.164 format with the country code.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inbound-ring-strategy">Ring strategy</Label>
            <Select
              value={strategy}
              disabled={disabled}
              onValueChange={(value) => {
                if (value === 'simultaneous' || value === 'browser_fallback') setStrategy(value)
              }}
            >
              <SelectTrigger id="inbound-ring-strategy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simultaneous">Ring browser and mobile together</SelectItem>
                <SelectItem value="browser_fallback">Ring mobile after browser</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">Your mobile asks you to press 1 before connecting.</p>
          </div>
        </div>

        <div className="border-t border-border py-4">
          <Button type="submit" disabled={disabled}>{disabled ? 'Saving…' : 'Save forwarding'}</Button>
        </div>
      </form>
    </section>
  )
}
