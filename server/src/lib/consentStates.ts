// The static two-party-consent state list (ticket T-1-021, journey 2.3 step 2).
//
// WHAT THIS IS
//
// US call-recording law splits roughly two ways. In a **one-party** state, one person on
// the call consenting is enough — and that person is our own rep, so recording is fine.
// In an **all-party** (commonly "two-party") state, everyone on the call has to consent,
// and a silent recording is the thing that gets a company sued.
//
// WHAT THIS IS NOT
//
// **This is not legal advice, and the app never presents it as such.** It is a product
// heuristic built on one weak signal — the area code of the number we dialled — which is
// not the same as where the person actually is. A 415 mobile answers in Texas every day.
// Journey 3.14b's rule applies here: legal reasoning stays out of the UI. The rep sees a
// dot and a plain sentence about the area code, never a paragraph about statutes.
//
// So the list is deliberately BROAD. Being wrong in the "did not record" direction costs
// a recording. Being wrong the other way is the expensive one.
//
// Sources are secondary and each state has its own nuance a summary cannot carry —
// Connecticut differs between civil and criminal, Nevada's telephone rule differs from
// its in-person one, and Michigan's participant exception is genuinely contested. Every
// one of those is included here, because each is contested in the direction of "record
// it and find out".

/**
 * States where every party to a call must consent. USPS two-letter codes.
 *
 * No US territory appears here — none has an all-party statute — so a Puerto Rico or
 * Guam number takes the one-party path.
 */
export const TWO_PARTY_CONSENT_STATES: ReadonlySet<string> = new Set([
  'CA', // California — Cal. Penal Code § 632
  'CT', // Connecticut — all-party for civil liability
  'DE', // Delaware — 11 Del. C. § 2402
  'FL', // Florida — Fla. Stat. § 934.03
  'IL', // Illinois — 720 ILCS 5/14-2
  'MD', // Maryland — Md. Code, Cts. & Jud. Proc. § 10-402
  'MA', // Massachusetts — Mass. Gen. Laws ch. 272 § 99
  'MI', // Michigan — contested; listed because the contest is not ours to win
  'MT', // Montana — Mont. Code Ann. § 45-8-213
  'NV', // Nevada — all-party for telephone calls specifically
  'NH', // New Hampshire — N.H. Rev. Stat. § 570-A:2
  'OR', // Oregon — listed with the broad reading
  'PA', // Pennsylvania — 18 Pa. C.S. § 5704
  'WA', // Washington — Wash. Rev. Code § 9.73.030
]);

/** True when this US state requires every party to consent. Unknown states are false. */
export function isTwoPartyConsentState(state: string | null): boolean {
  return state !== null && TWO_PARTY_CONSENT_STATES.has(state);
}
