import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TagInput } from '@/components/ui/tag-input'
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
import { cn } from '@/lib/utils'
import { useGetCaptureSettings, useSetCaptureOptOut, useUpdateCaptureSettings } from '@/hooks/captureSettings'
import type { CaptureSettings, LogActivityType } from '@/lib/captureSettingsTypes'
import { useAuth } from '@/providers/useAuth'

const LOG_OPTIONS: Array<{ value: LogActivityType; label: string }> = [
  { value: 'email', label: 'Email' },
  { value: 'meetings', label: 'Meetings' },
  { value: 'both', label: 'Both' },
]

const BACKFILL_OPTIONS: Array<{ value: 3 | 6 | 12; label: string }> = [
  { value: 3, label: '3 mo' },
  { value: 6, label: '6 mo' },
  { value: 12, label: '12 mo' },
]

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface p-1">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-6 rounded px-2 text-xs font-medium transition-colors',
            value === option.value ? 'bg-bg text-text shadow-sm' : 'text-text-muted hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-sm font-medium">{label}</Label>
      {description && <p className="text-xs text-text-muted">{description}</p>}
      {children}
    </div>
  )
}

function ToggleField({ id, label, description, checked, disabled, onCheckedChange }: { id: string; label: string; description?: string; checked: boolean; disabled: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/**
 * Settings → Integrations → Capture (doc 5 §5.2f). The admin configures which
 * mail gets captured; the exclusion evaluator (server/src/lib/captureExclusions.ts)
 * applies these rules at the matcher's step 2. A non-admin sees the admin rules
 * read-only with "Set by your admin", but can still opt their own mailbox out.
 */
export function Settings_Integrations_Capture() {
  const { org, isAdmin } = useAuth()
  const orgId = org?.id ?? null
  const query = useGetCaptureSettings(orgId)
  const update = useUpdateCaptureSettings(orgId ?? '')
  const setOptOut = useSetCaptureOptOut(orgId ?? '')

  const [form, setForm] = useState<CaptureSettings | null>(null)
  const [loadedFrom, setLoadedFrom] = useState<CaptureSettings | null>(null)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)

  // Initialize the editable form from the server settings once they arrive, and
  // re-sync after a save. Adjusting state during render (guarded by the identity
  // check) is the React-recommended way to mirror server data into local state.
  const serverSettings = query.data?.captureSettings ?? null
  if (serverSettings && serverSettings !== loadedFrom) {
    setLoadedFrom(serverSettings)
    setForm(serverSettings)
  }

  if (!org) return null

  const settings = form ?? query.data?.captureSettings
  const optedOut = query.data?.optedOut ?? false
  const loading = query.isPending && settings === undefined

  function patch(partial: Partial<CaptureSettings>): void {
    if (!settings) return
    setForm({ ...settings, ...partial })
  }

  async function save(): Promise<void> {
    if (!form) return
    try {
      const result = await update.mutateAsync(form)
      setSaveDialogOpen(false)
      toast.success(result.purgeQueued
        ? 'Capture settings saved. Previously captured matching activity will be removed.'
        : 'Capture settings saved.')
    } catch {
      toast.error('Could not save capture settings. Check the fields and try again.')
    }
  }

  async function toggleOptOut(next: boolean): Promise<void> {
    try {
      await setOptOut.mutateAsync(next)
      toast.success(next ? 'Your mailbox is excluded from capture.' : 'Your mailbox is included in capture.')
    } catch {
      toast.error('Could not update your capture setting. Try again.')
    }
  }

  if (loading) {
    return <p className="text-sm text-text-muted">Loading capture settings.</p>
  }

  if (query.isError || !settings) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <p className="text-sm text-destructive">Could not load capture settings.</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>Try again</Button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Capture</h2>
        <p className="text-sm text-text-muted">Choose which email and meetings get logged to the CRM.</p>
      </div>

      {!isAdmin && <p className="text-xs text-text-muted">Set by your admin.</p>}

      <div className="flex flex-col gap-6">
        <Field label="Internal domains" description="Messages where every participant is on these domains are internal and never captured.">
          <TagInput
            aria-label="Internal domains"
            value={settings.internalDomains}
            disabled={!isAdmin}
            placeholder="Add a domain"
            onValueChange={(internalDomains) => patch({ internalDomains })}
          />
        </Field>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field label="Domain allow-list" description="If set, only these domains are captured.">
            <TagInput
              aria-label="Domain allow-list"
              value={settings.allowDomains}
              disabled={!isAdmin}
              placeholder="Add a domain"
              onValueChange={(allowDomains) => patch({ allowDomains })}
            />
          </Field>
          <Field label="Domain deny-list" description="Messages from these domains are never captured.">
            <TagInput
              aria-label="Domain deny-list"
              value={settings.excludeDomains}
              disabled={!isAdmin}
              placeholder="Add a domain"
              onValueChange={(excludeDomains) => patch({ excludeDomains })}
            />
          </Field>
        </div>

        <Field label="Address excludes" description="Specific addresses never captured.">
          <TagInput
            aria-label="Address excludes"
            value={settings.excludeAddresses}
            disabled={!isAdmin}
            placeholder="Add an email address"
            onValueChange={(excludeAddresses) => patch({ excludeAddresses })}
          />
        </Field>

        <ToggleField
          id="capture-role-addresses"
          label="Auto-exclude role addresses"
          description="Drops help@, no-reply@, billing@, and similar addresses."
          checked={settings.excludeRoleAddresses}
          disabled={!isAdmin}
          onCheckedChange={(excludeRoleAddresses) => patch({ excludeRoleAddresses })}
        />

        <div className="flex flex-col gap-3">
          <ToggleField
            id="capture-bulk-inbound"
            label="Drop bulk inbound"
            description="Treat a message with more than this many recipients as a blast."
            checked={settings.dropBulkInbound}
            disabled={!isAdmin}
            onCheckedChange={(dropBulkInbound) => patch({ dropBulkInbound })}
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="bulk-inbound-max" className="text-sm text-text-muted">More than</Label>
            <Input
              id="bulk-inbound-max"
              type="number"
              min={1}
              className="h-8 w-20"
              value={settings.bulkInboundMax}
              disabled={!isAdmin || !settings.dropBulkInbound}
              onChange={(event) => patch({ bulkInboundMax: Number(event.target.value) || 1 })}
            />
            <span className="text-sm text-text-muted">recipients</span>
          </div>
        </div>

        <Field label="Subject-keyword excludes" description="Messages whose subject matches a phrase are never captured. Quote a phrase for an exact match.">
          <TagInput
            aria-label="Subject-keyword excludes"
            value={settings.subjectExcludes}
            disabled={!isAdmin}
            placeholder="Add a phrase"
            onValueChange={(subjectExcludes) => patch({ subjectExcludes })}
          />
        </Field>

        <Field label="What to log">
          <Segmented
            aria-label="What to log"
            value={settings.logActivityTypes}
            options={LOG_OPTIONS}
            disabled={!isAdmin}
            onChange={(logActivityTypes) => patch({ logActivityTypes })}
          />
        </Field>

        <Field label="Back-fill window" description="How far back the first sync reaches.">
          <Segmented
            aria-label="Back-fill window"
            value={settings.backfillMonths}
            options={BACKFILL_OPTIONS}
            disabled={!isAdmin}
            onChange={(backfillMonths) => patch({ backfillMonths })}
          />
        </Field>
      </div>

      {isAdmin && (
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={update.isPending} onClick={() => setSaveDialogOpen(true)}>
            {update.isPending ? 'Saving' : 'Save capture settings'}
          </Button>
        </div>
      )}

      <div className="border-t border-border pt-6">
        <ToggleField
          id="capture-opt-out"
          label="Exclude my mailbox from capture"
          description="Stop logging email and meetings from your own mailbox."
          checked={optedOut}
          disabled={setOptOut.isPending}
          onCheckedChange={(next) => void toggleOptOut(next)}
        />
      </div>

      <AlertDialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save capture settings</AlertDialogTitle>
            <AlertDialogDescription>
              New exclusions remove matching activity already captured. Removing an exclusion resumes capture going forward but does not re-import activity that was removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" disabled={update.isPending} onClick={() => void save()}>
              Save changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
