import { generateHTML, type JSONContent } from '@tiptap/core'

import { buildEditorExtensions } from '@/components/editor/editorExtensions'

const RENDER_EXTENSIONS = buildEditorExtensions({
  placeholder: '',
  getMentionItems: () => [],
})

/** Turns the server-owned TipTap document into the same safe HTML the editor displays. */
export function callCommentBodyHtml(bodyJson: JSONContent | null): string {
  return bodyJson ? generateHTML(bodyJson, RENDER_EXTENSIONS) : ''
}

/** A comment must contain readable text, not only an empty TipTap document. */
export function callCommentHasText(bodyJson: JSONContent): boolean {
  if (typeof bodyJson.text === 'string' && bodyJson.text.trim() !== '') return true
  return bodyJson.content?.some(callCommentHasText) ?? false
}
