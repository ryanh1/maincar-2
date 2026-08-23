import { useMemo } from 'react'

import { useGetObject, useGetObjects, useListRecords } from '@/hooks/crm'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import type { AttributeDef, ObjectDef, RecordRow } from '@/lib/crmTypes'

import type { MentionSuggestion } from './mentionResolver'

const RECORD_KINDS = [
  { slug: 'person', kind: 'contact' },
  { slug: 'company', kind: 'company' },
  { slug: 'deal', kind: 'deal' },
] as const

function recordLabel(row: RecordRow, object: ObjectDef | null, attributes: AttributeDef[]): string {
  const identity = attributes.find((attribute) => attribute.isIdentity)
  const value = identity ? row[identity.slug] : row.name ?? row.title
  return typeof value === 'string' && value.trim() !== '' ? value : object?.name ? `${object.name} ${row.id}` : row.id
}

function useRecordMentionSuggestions(
  orgId: string | null | undefined,
  object: ObjectDef | null,
  kind: Exclude<MentionSuggestion['kind'], 'teammate'>,
): { items: MentionSuggestion[]; isPending: boolean } {
  const detail = useGetObject(orgId, object?.id ?? null)
  const records = useListRecords(orgId, object?.id ?? null)
  const items = useMemo(() => {
    const attributes = detail.data?.object.attributes ?? []
    return (records.data?.pages.flatMap((page) => page.rows) ?? []).map((row) => ({
      id: row.id,
      label: recordLabel(row, object, attributes),
      kind,
      detail: object?.name ?? kind,
    }))
  }, [detail.data?.object.attributes, kind, object, records.data?.pages])
  return { items, isPending: detail.isPending || records.isPending }
}

/**
 * The one org-scoped catalog used by every DOM and canvas @ host. The visible
 * label is a convenience; `id` plus `kind` is the rename-safe persisted value.
 */
export function useMentionSuggestions(orgId: string | null | undefined) {
  const members = useGetMembers(orgId, { limit: 200, sort: 'name' })
  const objects = useGetObjects(orgId)
  const bySlug = new Map((objects.data?.objects ?? []).map((object) => [object.slug, object]))
  const people = useRecordMentionSuggestions(orgId, bySlug.get(RECORD_KINDS[0].slug) ?? null, RECORD_KINDS[0].kind)
  const companies = useRecordMentionSuggestions(orgId, bySlug.get(RECORD_KINDS[1].slug) ?? null, RECORD_KINDS[1].kind)
  const deals = useRecordMentionSuggestions(orgId, bySlug.get(RECORD_KINDS[2].slug) ?? null, RECORD_KINDS[2].kind)

  const items = useMemo<MentionSuggestion[]>(() => [
    ...(members.data?.members ?? []).map((member) => ({
      id: member.userId,
      label: memberDisplayName(member),
      kind: 'teammate' as const,
      detail: member.email,
    })),
    ...people.items,
    ...companies.items,
    ...deals.items,
  ], [companies.items, deals.items, members.data?.members, people.items])

  return {
    items,
    isPending: members.isPending || objects.isPending || people.isPending || companies.isPending || deals.isPending,
  }
}
