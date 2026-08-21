// The barrel is the only thing components import from this domain
// (CLAUDE.md → Hooks Organization). A component imports from `@/hooks/integrations`,
// never from a file path inside it.
export { useGetIntegrations } from './useGetIntegrations'
export { useGetIntegrationHealth } from './useGetIntegrationHealth'
export { useConnectIntegration } from './useConnectIntegration'
export { useTestIntegration } from './useTestIntegration'
export { useRefreshIntegration } from './useRefreshIntegration'
export { useDisconnectIntegration } from './useDisconnectIntegration'
// What each mutation is called with. These are hook shapes, not API shapes, so they
// live beside the hook rather than in lib/integrationTypes.ts — that file mirrors the
// server's responses and nothing else.
export type { ConnectIntegrationVariables, ConnectMode } from './useConnectIntegration'
export type { TestIntegrationVariables } from './useTestIntegration'
export type { RefreshIntegrationVariables } from './useRefreshIntegration'
export type { DisconnectIntegrationVariables } from './useDisconnectIntegration'
// The response and copy shapes live in lib/integrationTypes.ts, because the card and
// the tab need them without reaching for a hook. Re-exported here so a component that
// already imports a hook does not need a second import path.
export type {
  Provider,
  ConnectionStatus,
  IntegrationErrorCode,
  Capability,
  IntegrationConnection,
  IntegrationCard,
  CapabilityResult,
  TestConnectionResult,
  TestConnectionResponse,
  BrokenConnection,
  GetIntegrationsResponse,
  GetIntegrationHealthResponse,
  AuthorizeResponse,
  ConnectionResponse,
  ErrorCodeRecovery,
  PreConnectNote,
  OAuthPopupMessage,
} from '@/lib/integrationTypes'
export {
  INTEGRATION_ERROR_CODES,
  ERROR_CODE_RECOVERY,
  recoveryFor,
  PRE_CONNECT_NOTES,
  preConnectNotesFor,
  OAUTH_MESSAGE_TYPE,
  isOAuthPopupMessage,
} from '@/lib/integrationTypes'
