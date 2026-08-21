/** The short, actionable copy shown when a call does not complete normally. */
export type CallOutcome = 'busy' | 'no-answer' | 'failed' | 'dropped'

export function callOutcomeMessage(outcome: CallOutcome): string {
  switch (outcome) {
    case 'busy':
      return 'The number is busy. Try again later.'
    case 'no-answer':
      return 'No one answered. Try again later.'
    case 'failed':
      return 'The call could not connect. Check your connection and try again.'
    case 'dropped':
      return 'The call dropped. Try again.'
  }
}
