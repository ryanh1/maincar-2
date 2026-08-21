/**
 * The password rule the sign-up screens state, and the rule they enforce.
 *
 * EIGHT, deliberately stricter than the backend. Firebase Auth only rejects
 * below six (`auth/weak-password` → "Password should be at least 6 characters"),
 * and Identity Platform's configurable policy is not turned on, so six is all
 * the backend guarantees.
 *
 * Matching the backend down to six was considered and rejected: a minimum on
 * our own screens is a real control for everyone who signs up through them, and
 * dropping it would weaken every new password to buy consistency with a limit
 * nobody sees. Being stricter than the floor is not a lie — the screen enforces
 * exactly what it states.
 *
 * The gap is real though: the same account can be created at six characters
 * through another Firebase entry point. Closing it means raising the Firebase
 * password policy to eight, after which this constant and the backend agree.
 * Until then this is the stricter of the two, which is the safe direction.
 */
export const PASSWORD_MIN_LENGTH = 8

/** Stated on screen before the person types, never discovered by failing. */
export const PASSWORD_RULE = `At least ${PASSWORD_MIN_LENGTH} characters`

/** The one line to show when the password is not usable yet, or null when it is. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  return null
}
