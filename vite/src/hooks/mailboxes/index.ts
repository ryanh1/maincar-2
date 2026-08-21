// The barrel is the only thing components import from this domain
// (CLAUDE.md → Hooks Organization). A component imports from `@/hooks/mailboxes`,
// never from a file path inside it.
export { useGetMailboxes } from './useGetMailboxes'
export { useSetPrimaryMailbox } from './useSetPrimaryMailbox'
export { useUpdateMailbox } from './useUpdateMailbox'
export { useDisconnectMailbox } from './useDisconnectMailbox'
// What each mutation is called with. These are hook shapes, not API shapes, so they
// live beside the hook rather than in lib/mailboxTypes.ts — that file mirrors the
// server's responses and nothing else.
export type { SetPrimaryMailboxVariables } from './useSetPrimaryMailbox'
export type { UpdateMailboxVariables } from './useUpdateMailbox'
export type { DisconnectMailboxVariables } from './useDisconnectMailbox'
// The response and mailbox shapes live in lib/mailboxTypes.ts, because the row and the
// drawer need them without reaching for a hook. Re-exported here so a component that
// already imports a hook does not need a second import path.
export type {
  Mailbox,
  GetMailboxesResponse,
  MailboxListResponse,
  MailboxResponse,
} from '@/lib/mailboxTypes'
