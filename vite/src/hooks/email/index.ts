// The barrel is the only thing components import from this domain
// (CLAUDE.md → Hooks Organization).
export { useGetEmailDrafts } from './useGetEmailDrafts'
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
