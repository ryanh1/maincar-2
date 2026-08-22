import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { RichTextEditor, type LinkRequest } from '@/components/editor/RichTextEditor'
import { RichTextEditorUrlDialog } from '@/components/editor/RichTextEditor_UrlDialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { useSaveEmailTemplate } from '@/hooks/email'
import type { EmailTemplate, SaveEmailTemplateVariables } from '@/hooks/email'
import type { EmailTemplateVisibility } from '@/lib/emailTypes'
import { ApiError } from '@/lib/api'

interface Props {
  orgId: string
  /** The template being edited, or `null` to write a new one. */
  template: EmailTemplate | null
  /** Called after a save lands, and on Cancel. The list comes back either way. */
  onDone: () => void
}

/**
 * Write a template, or edit one.
 *
 * One form for both, because it IS one form — the same three fields, the same
 * Save button. `useSaveEmailTemplate` takes the same view: an id present means
 * PATCH, absent means POST, and nothing here has to choose between two hooks.
 *
 * The body is the shared `RichTextEditor` the composer card uses, not a second
 * editor (SPEC-composer-templates.md § 3). It is seeded once through
 * `initialHtml` and never re-read — the parent mounts this component fresh for
 * each template, which is the remount that editor's API asks for.
 *
 * The parent only opens this form for a template the viewer may manage. The
 * server repeats that check, because a hidden action is guidance, not security.
 */
export function Settings_EmailTemplates_Form({ orgId, template, onDone }: Props) {
  const saveTemplate = useSaveEmailTemplate()

  const [name, setName] = useState(template?.name ?? '')
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [visibility, setVisibility] = useState<EmailTemplateVisibility>(template?.visibility ?? 'PRIVATE')
  // The editor owns the text while it is open and hands it back on every change.
  // This copy is only ever READ on save — it never flows back into the editor.
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? '')
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()

    // `required` on the input catches an empty field; it does not catch a name
    // of nothing but spaces, which the server refuses with this same sentence.
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name the template to save it.')
      return
    }

    // Written as a branch rather than `templateId: template?.id`, because the
    // hook's variables are a union: creating requires a name, editing takes any
    // subset, and an `id` typed `string | undefined` narrows to neither.
    const variables: SaveEmailTemplateVariables = template
      ? { orgId, templateId: template.id, name: trimmed, subject, bodyHtml, visibility }
      : { orgId, name: trimmed, subject, bodyHtml, visibility }

    saveTemplate.mutate(variables, {
      onSuccess: () => {
        toast.success('Template saved.')
        onDone()
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiError ? error.message : 'Could not save the template. Try again.',
        ),
    })
  }

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-base font-semibold">{template ? 'Edit template' : 'New template'}</h2>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex max-w-sm flex-col gap-1.5">
          <Label htmlFor="templateName">
            Name <RequiredAsterisk />
          </Label>
          <Input
            id="templateName"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="templateSubject">Subject</Label>
          <Input
            id="templateSubject"
            maxLength={998}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="templateSharing"
              checked={visibility === 'ORGANIZATION'}
              onCheckedChange={(checked) => setVisibility(checked === true ? 'ORGANIZATION' : 'PRIVATE')}
            />
            <Label htmlFor="templateSharing">Share with organization</Label>
          </div>
          <p className="text-xs text-text-muted">
            {visibility === 'ORGANIZATION'
              ? 'Everyone in this organization can use this template.'
              : 'Only you can use this template.'}
          </p>
          {template?.visibility === 'ORGANIZATION' && visibility === 'PRIVATE' && (
            <p className="text-xs text-text-muted">
              Teammates lose access. Emails already written from this template stay unchanged.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {/* A plain span, not `Label`: the editable region is a contenteditable
              div, and `htmlFor` does not reach one. The editor carries the same
              words as its own accessible name through `label` below. */}
          <span className="text-sm font-medium">Body</span>
          <div className="flex h-64 flex-col overflow-hidden rounded-md border border-border">
            <RichTextEditor
              label="Body"
              placeholder="Write the email"
              initialHtml={template?.bodyHtml ?? ''}
              onChange={setBodyHtml}
              onRequestLink={setLinkRequest}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saveTemplate.isPending}>
            {saveTemplate.isPending ? 'Saving…' : 'Save template'}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>

      <RichTextEditorUrlDialog request={linkRequest} onClose={() => setLinkRequest(null)} />
    </section>
  )
}
