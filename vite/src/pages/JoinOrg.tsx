import { useState, type FormEvent } from 'react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { useNavigate, useParams } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { AuthCard } from '@/components/AuthCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { getFirebaseAuth } from '@/dependencies/firebase'
import { useAcceptInvitation, useGetPublicInvitation } from '@/hooks/orgs'
import { useUpdateProfile } from '@/hooks/profile'
import { ApiError } from '@/lib/api'
import { authErrorToMessage, isUnreachable } from '@/lib/firebaseErrors'
import { passwordProblem } from '@/lib/passwordPolicy'
import { getRoleLabel } from '@/lib/roles'
import { useAuth } from '@/providers/useAuth'

/** The one line for every dead link. See `DEAD_LINK` below for why it is one line. */
const DEAD_LINK_HEADING = 'This invite is no longer valid'
const DEAD_LINK_FIX = 'Ask the admin for a new one.'

/**
 * `/join/:token` — the invitee's screen. Public, outside `ProtectedLayout`,
 * because the person opening it may have no account at all.
 *
 * Four states, decided by who is signed in and what the server said:
 *   1. Nobody            → create an account or sign in, then accept, in one submit.
 *   2. The invited person → one button.
 *   3. Somebody else     → both addresses named, and a way out that lands back here.
 *   4. Nothing usable    → one message for a dead link, a different one for a
 *                          server we could not reach. Those are not the same
 *                          problem and must never read as if they were.
 */
export function JoinOrg() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { firebaseUser, isLoading: authLoading, signOut } = useAuth()

  const invitationQuery = useGetPublicInvitation(token)
  const acceptInvitation = useAcceptInvitation()
  const updateProfile = useUpdateProfile()

  const [mode, setMode] = useState<'create' | 'signIn'>('create')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // The server is the authority on who this invite belongs to. It compares the
  // invited address to the User ROW's email; the check below compares it to the
  // Firebase account's. They are normally the same, and when they are not, the
  // server wins — so its 409 puts the screen into the same mismatch state rather
  // than flashing a toast over a screen that still says "Join".
  const [serverMismatchMessage, setServerMismatchMessage] = useState<string | null>(null)

  const invitation = invitationQuery.data
  const orgName = invitation?.orgName ?? 'the organization'

  // --- State 4: the link could not be read ------------------------------------
  if (invitationQuery.isError) {
    const err = invitationQuery.error
    // 404 is EVERY dead end — missing, expired, revoked, already accepted — and
    // the server answers all four identically on purpose, so a scanner cannot
    // tell a wrong token from a spent one. The screen keeps that promise: one
    // message, and the fix is the same in all four cases.
    const isDeadLink = err instanceof ApiError && err.status === 404
    if (isDeadLink) {
      return (
        <AuthCard title={DEAD_LINK_HEADING}>
          <p className="text-center text-sm text-muted-foreground">{DEAD_LINK_FIX}</p>
        </AuthCard>
      )
    }

    // Anything else is OUR problem, not the link's. Saying "no longer valid"
    // here sends the invitee to ask for a replacement link that will fail the
    // same way.
    const message = isUnreachable(err)
      ? 'Cannot reach the server. Try again in a moment.'
      : err instanceof ApiError
        ? err.message
        : 'Could not open this invite. Try again in a moment.'
    return (
      <AuthCard title="Could not open this invite">
        <p className="text-center text-sm text-muted-foreground">{message}</p>
        <Button
          className="mt-6 w-full"
          disabled={invitationQuery.isFetching}
          onClick={() => void invitationQuery.refetch()}
        >
          {invitationQuery.isFetching ? 'Trying…' : 'Try again'}
        </Button>
      </AuthCard>
    )
  }

  if (invitationQuery.isPending || authLoading) {
    return (
      <AuthCard>
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      </AuthCard>
    )
  }

  async function accept() {
    const result = await acceptInvitation.mutateAsync(token!)
    // The whole cache was just cleared, and the store's memberships are stale, so
    // a full reload is the only honest way back into the app.
    window.location.assign('/home')
    return result
  }

  function reportAcceptFailure(err: unknown) {
    if (err instanceof ApiError && err.code === 'email_mismatch') {
      setServerMismatchMessage(err.message)
      return
    }
    if (err instanceof ApiError && err.status === 404) {
      setError(`${DEAD_LINK_HEADING}. ${DEAD_LINK_FIX}`)
      return
    }
    setError(authErrorToMessage(err, mode === 'create' ? 'signUp' : 'signIn'))
  }

  // --- State 3: signed in as somebody else -----------------------------------
  const signedInEmail = firebaseUser?.email ?? ''
  const addressesDiffer =
    !!firebaseUser && !!invitation && signedInEmail.toLowerCase() !== invitation.email.toLowerCase()

  if (firebaseUser && invitation && (addressesDiffer || serverMismatchMessage)) {
    const invitedEmail = invitation.email
    return (
      <AuthCard title="Wrong account">
        <p className="text-center text-sm text-muted-foreground">
          {/* Both addresses, always — "wrong account" on its own leaves the reader
              with no way to work out which account to use. When the server is the
              one calling it a mismatch, the Firebase address is not the one it
              compared, so its own sentence is the truthful one to show. */}
          {addressesDiffer
            ? `This invite was sent to ${invitedEmail}. You are signed in as ${signedInEmail || 'another account'}.`
            : serverMismatchMessage}
        </p>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            // Sign out AND carry the invite with them, so signing in as the right
            // person lands back on this link instead of on the home page with the
            // invite lost.
            void signOut().then(() =>
              navigate('/auth/sign-in', {
                replace: true,
                state: { from: `/join/${encodeURIComponent(token!)}`, email: invitedEmail },
              }),
            )
          }}
        >
          Sign out and sign in as {invitedEmail}
        </Button>
      </AuthCard>
    )
  }

  // --- State 2: signed in as the invited person ------------------------------
  if (firebaseUser && invitation) {
    return (
      <AuthCard title={`Join ${orgName}`}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {invitation.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {getRoleLabel(role)}
            </Badge>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          className="mt-6 w-full"
          disabled={acceptInvitation.isPending}
          onClick={() => {
            setError('')
            void accept().catch(reportAcceptFailure)
          }}
        >
          {acceptInvitation.isPending ? 'Joining…' : `Join ${orgName}`}
        </Button>
      </AuthCard>
    )
  }

  // --- State 1: nobody is signed in ------------------------------------------
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!invitation) return
    setError('')

    if (mode === 'create') {
      const problem = passwordProblem(password)
      if (problem) return setError(problem)
    }

    setSubmitting(true)
    try {
      const auth = getFirebaseAuth()
      if (mode === 'create') {
        await createUserWithEmailAndPassword(auth, invitation.email, password)
      } else {
        await signInWithEmailAndPassword(auth, invitation.email, password)
      }

      // The name is saved BEFORE the accept, so a failure here leaves the person
      // with no membership rather than a membership and no name — the first is
      // recoverable by opening the link again, the second is not.
      if (mode === 'create' && firstName.trim() && lastName.trim()) {
        await updateProfile.mutateAsync({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      }

      await accept()
    } catch (err) {
      reportAcceptFailure(err)
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      title={`Join ${orgName}`}
      subtitle={mode === 'create' ? `Create your ${APP_NAME} account.` : 'Sign in to accept.'}
      footer={
        <>
          {mode === 'create' ? 'Already have an account? ' : 'Need an account? '}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setError('')
              setMode(mode === 'create' ? 'signIn' : 'create')
            }}
          >
            {mode === 'create' ? 'Sign in' : 'Create one'}
          </button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="joinEmail">Email</Label>
          {/* Disabled, not hidden: the invite is bound to this address on the
              server, so letting it be edited would only produce a 409. */}
          <Input id="joinEmail" type="email" value={invitation?.email ?? ''} disabled />
        </div>

        {mode === 'create' && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="joinFirstName">
                First name <RequiredAsterisk />
              </Label>
              <Input
                id="joinFirstName"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="joinLastName">
                Last name <RequiredAsterisk />
              </Label>
              <Input
                id="joinLastName"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="joinPassword">
            Password <RequiredAsterisk />
          </Label>
          <PasswordInput
            id="joinPassword"
            required
            showRequirement={mode === 'create'}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Joining…' : `Join ${orgName}`}
        </Button>
      </form>
    </AuthCard>
  )
}
