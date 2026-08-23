export type InboundForwardingStrategy = 'simultaneous' | 'browser_fallback'

export interface InboundForwarding {
  enabled: boolean
  mobileE164: string | null
  strategy: InboundForwardingStrategy
}

export interface InboundForwardingResponse {
  inboundForwarding: InboundForwarding
}

export type InboundForwardingPatch = InboundForwarding
