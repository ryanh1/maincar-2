// The barrel is the only thing components import from this domain
// (frontend.md → Frontend data fetching).
export { useGetCalls } from './useGetCalls'
export { useGetCallDetail } from './useGetCallDetail'
export { useGetVoiceToken } from './useGetVoiceToken'
export { isAdoptableInFlightCallError, useCreateCall } from './useCreateCall'
export { useEndCall } from './useEndCall'

// What each mutation is called with. These are hook shapes, not API shapes, so
// they live beside the hook rather than in lib/callTypes.ts — that file mirrors
// the server's responses and nothing else.
export type { CreateCallVariables } from './useCreateCall'
export type { EndCallVariables } from './useEndCall'

// The API shapes and the list params live in lib/callTypes.ts, re-exported here
// so a component that already imports a hook does not need a second import path.
export type {
  Call,
  CallHistoryItem,
  CallDetail,
  CallDirection,
  CallStatus,
  TranscriptStatus,
  CreateCallInput,
  CallSortColumn,
  GetCallsParams,
  GetCallsResponse,
  CreateCallResponse,
  CallDetailResponse,
  VoiceTokenResponse,
} from '@/lib/callTypes'
export { CALL_SORT_COLUMNS } from '@/lib/callTypes'
