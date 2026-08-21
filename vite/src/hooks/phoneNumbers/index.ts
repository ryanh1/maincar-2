// The barrel is the only thing components import from this domain
// (frontend.md → Frontend data fetching).
export { useGetNumbers } from './useGetNumbers'
export { useSearchAvailableNumbers } from './useSearchAvailableNumbers'
export { useBuyNumber } from './useBuyNumber'
export { useSetActiveNumber } from './useSetActiveNumber'
export { useGetOrgNumbers } from './useGetOrgNumbers'
export { useAssignNumber } from './useAssignNumber'

// What each mutation is called with. These are hook shapes, not API shapes, so
// they live beside the hook rather than in lib/phoneNumberTypes.ts — that file
// mirrors the server's responses and nothing else.
export type { SearchAvailableNumbersVariables } from './useSearchAvailableNumbers'
export type { BuyNumberVariables } from './useBuyNumber'
export type { SetActiveNumberVariables } from './useSetActiveNumber'
export type { AssignNumberVariables } from './useAssignNumber'

// The API shapes live in lib/phoneNumberTypes.ts, re-exported here so a component
// that already imports a hook does not need a second import path.
export type {
  PhoneNumber,
  PhoneNumberStatus,
  AvailableNumber,
  GetNumbersResponse,
  SearchNumbersInput,
  SearchNumbersResponse,
  PhoneNumberResponse,
  PhoneNumberAssignee,
  OrgPhoneNumber,
  GetOrgNumbersResponse,
  OrgPhoneNumberResponse,
} from '@/lib/phoneNumberTypes'
