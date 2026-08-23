import { RichTextEditor } from './RichTextEditor'

/** Development-only browser fixture for the grouped @mention interaction. */
export function MentionEditorFixture() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-lg font-semibold">Mention editor fixture</h1>
      <RichTextEditor
        label="Note"
        placeholder="Write a note"
        mentionItems={[
          { id: 'user-ada', label: 'Ada Lovelace', kind: 'teammate', detail: 'ada@example.com' },
          { id: 'company-acme', label: 'Acme', kind: 'company', detail: 'Company' },
        ]}
        className="min-h-40 rounded-md border border-border"
      />
    </main>
  )
}
