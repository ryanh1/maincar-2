import { formatCellValue } from './recordCellValue'

import type { AttributeDef, RecordRow } from '@/lib/crmTypes'

interface KanbanCardProps {
  record: RecordRow
  titleAttribute: AttributeDef
  fields: AttributeDef[]
}

/** A compact, read-only summary of one CRM record in a Kanban column. */
export function KanbanCard({ record, titleAttribute, fields }: KanbanCardProps) {
  const title = formatCellValue(record[titleAttribute.slug], titleAttribute.type, null) || 'Untitled record'

  return (
    <article className="rounded-md border border-border bg-bg p-3 text-sm">
      <h3 className="truncate font-medium text-text">{title}</h3>
      {fields.length > 0 && (
        <dl className="mt-2 space-y-1 text-xs">
          {fields.map((field) => {
            const value = formatCellValue(record[field.slug], field.type, null)
            return (
              <div key={field.id} className="flex gap-2">
                <dt className="shrink-0 text-text-muted">{field.name}</dt>
                <dd className="min-w-0 truncate text-text">{value || '—'}</dd>
              </div>
            )
          })}
        </dl>
      )}
    </article>
  )
}
