// The Twilio Voice SDK is constructed HERE and nowhere else (CLAUDE.md → Third-
// party APIs / SDKs). `DialerProvider` imports `Device` from this module only —
// never from `@twilio/voice-sdk` directly — so a test can mock this one file
// instead of the whole WebRTC stack.
export { Device } from '@twilio/voice-sdk'
export type { Call as TwilioVoiceCall } from '@twilio/voice-sdk'
