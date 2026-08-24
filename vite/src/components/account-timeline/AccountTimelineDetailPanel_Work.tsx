import { generateHTML, type JSONContent } from '@tiptap/core'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { SanitizedHtml } from '@/components/editor/SanitizedHtml'
import { RichTextEditor, type RichTextEditorActions } from '@/components/editor/RichTextEditor'
import { buildEditorExtensions } from '@/components/editor/editorExtensions'
import { Button } from '@/components/ui/button'
import { useUpdateNote } from '@/hooks/crm'
import { useUpdateTask } from '@/hooks/tasks'
import type { AccountTimelineNoteDetail, AccountTimelineStageChangeDetail, AccountTimelineTaskDetail } from '@/lib/accountTimelineTypes'
import { formatDateTime } from '@/lib/datetime'

const TASK_TYPE: Record<string, string> = { call: 'Call', email: 'Email', todo: 'To-do' }
const TASK_PRIORITY: Record<string, string> = { low: 'Low', med: 'Medium', high: 'High' }

function linkLabel(object: string): string {
  return object === 'company' ? 'Company' : object === 'person' ? 'Person' : object === 'deal' ? 'Deal' : 'Record'
}

function recordPath(object: string, id: string): string {
  return `/records/${encodeURIComponent(object)}/${encodeURIComponent(id)}`
}

function noteHtml(bodyJson: unknown): string | null {
  try {
    return generateHTML(bodyJson as JSONContent, buildEditorExtensions({ placeholder: 'Write a note', getMentionItems: () => [] }))
  } catch {
    return null
  }
}

function textHtml(value: string): string {
  const element = document.createElement('div')
  element.textContent = value
  return `<p>${element.innerHTML.replace(/\n/g, '<br>')}</p>`
}

export function AccountTimelineDetailPanel_Note({ detail, orgId, timeZone }: { detail: AccountTimelineNoteDetail; orgId?: string | null; timeZone?: string | null }) {
  const updateNote = useUpdateNote()
  const [editing, setEditing] = useState(false)
  const [editorActions, setEditorActions] = useState<RichTextEditorActions | null>(null)
  const html = useMemo(() => noteHtml(detail.bodyJson), [detail.bodyJson])

  async function save(): Promise<void> {
    if (!orgId || !editorActions || updateNote.isPending) return
    try {
      await updateNote.mutateAsync({ orgId, noteId: detail.id, bodyJson: editorActions.getJSON() as Record<string, unknown> })
      setEditing(false)
      toast.success('Note saved.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the note. Try again.')
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="flex flex-col gap-1 border-b border-border pb-3">
        {detail.authorName && <p className="text-xs text-text-muted">By {detail.authorName}</p>}
        <p className="text-xs text-text-muted">Updated {formatDateTime(detail.updatedAt, timeZone)}</p>
      </section>
      {editing ? (
        <section className="flex flex-col gap-3" aria-label="Edit note">
          <RichTextEditor key={detail.id} label="Note" initialHtml={html ?? textHtml(detail.bodyText)} onReady={setEditorActions} className="min-h-48 rounded-md border border-border" />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!editorActions || updateNote.isPending} onClick={() => void save()}>{updateNote.isPending ? 'Saving…' : 'Save note'}</Button>
            <Button type="button" size="sm" variant="secondary" disabled={updateNote.isPending} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </section>
      ) : (
        <>
          {html ? <SanitizedHtml html={html} className="tiptap text-sm" /> : <p className="whitespace-pre-wrap text-text">{detail.bodyText}</p>}
          <div><Button type="button" size="sm" disabled={!orgId} onClick={() => setEditing(true)}>Edit note</Button></div>
        </>
      )}
      {detail.links && detail.links.length > 0 && (
        <section aria-labelledby="note-links-heading" className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 id="note-links-heading" className="text-sm font-semibold">Linked records</h3>
          <ul className="flex flex-wrap gap-2">
            {detail.links.map((link) => <li key={`${link.object}-${link.id}`}><Button asChild type="button" size="sm" variant="secondary"><a href={recordPath(link.object, link.id)}>{linkLabel(link.object)}</a></Button></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

export function AccountTimelineDetailPanel_Task({ detail, orgId, timeZone }: { detail: AccountTimelineTaskDetail; orgId?: string | null; timeZone?: string | null }) {
  const updateTask = useUpdateTask()
  const [completion, setCompletion] = useState<{ taskId: string; isDone: boolean } | null>(null)
  const isDone = completion?.taskId === detail.id ? completion.isDone : detail.isDone

  async function toggleDone(): Promise<void> {
    if (!orgId) return
    try {
      const response = await updateTask.mutateAsync({ orgId, taskId: detail.id, update: { isDone: !isDone } })
      setCompletion({ taskId: detail.id, isDone: response.task.isDone })
      toast.success(response.task.isDone ? 'Task completed.' : 'Task reopened.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the task. Try again.')
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{detail.title}</h3>
        {detail.body && <p className="whitespace-pre-wrap text-text">{detail.body}</p>}
      </section>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 border border-border p-3">
        <dt className="text-xs font-medium text-text-muted">Status</dt><dd>{isDone ? 'Completed' : 'Open'}</dd>
        <dt className="text-xs font-medium text-text-muted">Due</dt><dd>{detail.dueAt ? formatDateTime(detail.dueAt, timeZone) : 'No due date'}</dd>
        <dt className="text-xs font-medium text-text-muted">Assignee</dt><dd>{detail.assigneeName || (detail.assigneeUserId ? 'Assigned rep' : 'Unassigned')}</dd>
        <dt className="text-xs font-medium text-text-muted">Type</dt><dd>{TASK_TYPE[detail.taskType] ?? 'Task'}</dd>
        <dt className="text-xs font-medium text-text-muted">Priority</dt><dd>{TASK_PRIORITY[detail.priority] ?? 'Not set'}</dd>
      </dl>
      {detail.links && detail.links.length > 0 && (
        <section aria-labelledby="task-links-heading" className="flex flex-col gap-2">
          <h3 id="task-links-heading" className="text-sm font-semibold">Linked records</h3>
          <ul className="flex flex-wrap gap-2">
            {detail.links.map((link) => <li key={`${link.object}-${link.id}`}><Button asChild type="button" size="sm" variant="secondary"><a href={recordPath(link.object, link.id)}>{linkLabel(link.object)}</a></Button></li>)}
          </ul>
        </section>
      )}
      <div><Button type="button" size="sm" disabled={!orgId || updateTask.isPending} onClick={() => void toggleDone()}>{updateTask.isPending ? 'Saving…' : isDone ? 'Reopen task' : 'Complete task'}</Button></div>
    </div>
  )
}

export function AccountTimelineDetailPanel_Change({ detail, timeZone }: { detail: AccountTimelineStageChangeDetail; timeZone?: string | null }) {
  const before = detail.marker?.before || 'Not set'
  const after = detail.marker?.after || 'Not set'
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)] items-center gap-3" aria-label={`Changed from ${before} to ${after}`}>
        <div className="min-w-0 border border-border bg-surface p-3"><p className="text-xs font-medium text-text-muted">Before</p><p className="mt-1 break-words">{before}</p></div>
        <span aria-hidden className="text-text-muted">→</span>
        <div className="min-w-0 border border-border bg-surface-2 p-3"><p className="text-xs font-medium text-text-muted">After</p><p className="mt-1 break-words">{after}</p></div>
      </div>
      <p className="text-xs text-text-muted">{detail.actorName || 'Unknown actor'}{detail.occurredAt ? ` · ${formatDateTime(detail.occurredAt, timeZone)}` : ''}</p>
    </div>
  )
}
