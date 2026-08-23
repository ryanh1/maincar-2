import { useState } from 'react'

import { RichTextEditor, type RichTextEditorActions } from '@/components/editor/RichTextEditor'
import { useMentionSuggestions } from '@/components/editor/useMentionSuggestions'
import { Button } from '@/components/ui/button'
import { useCreateNote } from '@/hooks/crm'
import type { ObjectDef, RecordRow } from '@/lib/crmTypes'

/**
 * A note is the first rich-text surface that has a durable source row and can
 * therefore make @mention notifications reliable. It is automatically linked
 * to the record whose drawer owns it.
 */
export function RecordNoteComposer({ orgId, object, record }: { orgId: string; object: ObjectDef; record: RecordRow }) {
  const createNote = useCreateNote()
  const { items: mentionItems } = useMentionSuggestions(orgId)
  const [editorActions, setEditorActions] = useState<RichTextEditorActions | null>(null)
  const [mount, setMount] = useState(0)

  async function saveNote() {
    if (!editorActions || createNote.isPending) return
    try {
      await createNote.mutateAsync({
        orgId,
        bodyJson: editorActions.getJSON() as Record<string, unknown>,
        links: [{ object: object.slug, id: record.id }],
      })
      // Remounting after an explicit save is the intentional reset path. It is
      // unlike an autosave response: no one is still typing in this document.
      setEditorActions(null)
      setMount((value) => value + 1)
    } catch {
      // The route's error becomes the visible, actionable result below.
    }
  }

  return (
    <section className="border-b border-border p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">Add note</h3>
        <Button type="button" size="sm" disabled={!editorActions || createNote.isPending} onClick={() => void saveNote()}>
          {createNote.isPending ? 'Saving…' : 'Save note'}
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Type @ to mention a teammate or link a record.</p>
      <RichTextEditor
        key={mount}
        label="Note"
        placeholder="Write a note"
        mentionItems={mentionItems}
        onReady={setEditorActions}
        className="min-h-32 rounded-md border border-border"
      />
      {createNote.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {createNote.error instanceof Error ? createNote.error.message : 'Could not save note.'}
        </p>
      )}
    </section>
  )
}
