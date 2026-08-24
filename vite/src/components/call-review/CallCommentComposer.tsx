import { useMemo, useState } from 'react'
import type { JSONContent } from '@tiptap/core'

import { RichTextEditor, type RichTextEditorActions } from '@/components/editor/RichTextEditor'
import type { MentionSuggestion } from '@/components/editor/mentionResolver'
import { Button } from '@/components/ui/button'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import { callCommentBodyHtml, callCommentHasText } from '@/lib/callCommentBody'

interface CallCommentComposerProps {
  orgId: string
  label: string
  saveLabel: string
  initialBody?: JSONContent | null
  onSave: (bodyJson: JSONContent) => Promise<void>
  onCancel: () => void
}

/** One compact TipTap surface shared by root, reply, and edit journeys. */
export function CallCommentComposer({
  orgId,
  label,
  saveLabel,
  initialBody,
  onSave,
  onCancel,
}: CallCommentComposerProps) {
  const members = useGetMembers(orgId, { limit: 200, sort: 'name' })
  const [actions, setActions] = useState<RichTextEditorActions | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mentionItems = useMemo<MentionSuggestion[]>(() =>
    (members.data?.members ?? []).filter((member) => member.enabled).map((member) => ({
      id: member.userId,
      label: memberDisplayName(member),
      kind: 'teammate',
      detail: member.email,
    })), [members.data?.members])

  async function save(): Promise<void> {
    if (!actions || isSaving) return
    const bodyJson = actions.getJSON()
    if (!callCommentHasText(bodyJson)) {
      setError('Write a comment before posting.')
      actions.focusAtStart()
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await onSave(bodyJson)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the comment. Try again.')
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border bg-bg p-2">
      <p className="text-xs text-text-muted">Type @ to mention a teammate.</p>
      <RichTextEditor
        initialHtml={callCommentBodyHtml(initialBody ?? null)}
        label={label}
        placeholder="Write a comment"
        mentionItems={mentionItems}
        onReady={setActions}
        className="min-h-32 rounded-md border border-border"
      />
      {members.isError && <p role="alert" className="text-xs text-destructive">Could not load teammates. Try again before adding a mention.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={isSaving} onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" disabled={!actions || isSaving} onClick={() => void save()}>
          {isSaving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  )
}
