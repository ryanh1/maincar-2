// The barrel is the only thing components import from this domain
// (CLAUDE.md → Hooks Organization).
export { useGetEmailDrafts } from './useGetEmailDrafts'
export { useCreateEmailDraft } from './useCreateEmailDraft'
export { useUpdateEmailDraft } from './useUpdateEmailDraft'
export { useDeleteEmailDraft } from './useDeleteEmailDraft'
// What each mutation is called with. These are hook shapes, not API shapes, so
// they live beside the hook rather than in lib/emailTypes.ts — that file mirrors
// the server's responses and nothing else.
export type { CreateEmailDraftVariables } from './useCreateEmailDraft'
export type { UpdateEmailDraftVariables } from './useUpdateEmailDraft'
export type { DeleteEmailDraftVariables } from './useDeleteEmailDraft'
// The shapes themselves live in lib/emailTypes.ts, because the recipient fields
// need RecipientChip without reaching for a hook. Re-exported here so a
// component that already imports the hook does not need a second import path.
export type {
  EmailDraft,
  EmailDraftInput,
  EmailDraftPatch,
  GetEmailDraftsResponse,
  EmailDraftResponse,
  DeleteEmailDraftResponse,
  RecipientChip,
} from '@/lib/emailTypes'
