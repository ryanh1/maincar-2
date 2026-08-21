import { useState, type FormEvent } from 'react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { APP_NAME } from '@/config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { getFirebaseAuth } from '@/dependencies/firebase'
import { useAcceptInvitation, useGetPublicInvitation } from '@/hooks/orgs'
import { useUpdateProfile } from '@/hooks/profile'
import { ApiError } from '@/lib/api'
import { getRoleLabel } from '@/lib/roles'
import { useAuth } from '@/providers/useAuth'

/**
 * `/join/:token` — the invitee's screen. Public, outside `ProtectedLayout`,
 * because the person opening it may have no account at all.
 *
 * Three states, decided by who is signed in:
 *   1. Nobody          → create an account or sign in, then accept, in one submit.
 *   2. The invited person → one button.
 *   3. Somebody else   → the mismatch warning and a way out.
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
  const [submitting, setSubmitting] = useState(false)

  const invitation = invitationQuery.data
  const orgName = invitation?.orgName ?? 'the organization'

  // --- Unusable link ---------------------------------------------------------
  // Every failure mode is the same 404 by design, so the screen says one thing.
  if (invitationQuery.isError) {
    return (
      <Shell>
        <h1 className="display text-2xl font-bold">This invite is no longer valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ask the admin for a new one.</p>
      </Shell>
    )
  }

  if (invitationQuery.isPending || authLoading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Shell>
    )
  }

  async function accept() {
    const result = await acceptInvitation.mutateAsync(token!)
    // The whole cache was just cleared, and the store's memberships are stale, so
    // a full reload is the only honest way back into the app.
    window.location.assign('/home')
    return result
  }

  // --- State 3: signed in as somebody else -----------------------------------
  if (firebaseUser && invitation && firebaseUser.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <Shell>
        <h1 className="display text-2xl font-bold">Wrong account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This invite was sent to {invitation.email}. You are signed in as {firebaseUser.email}.
        </p>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            void signOut().then(() => navigate(0))
          }}
        >
          Sign out
        </Button>
      </Shell>
    )
  }

  // --- State 2: signed in as the invited person ------------------------------
  if (firebaseUser && invitation) {
    return (
      <Shell>
        <h1 className="display text-2xl font-bold">Join {orgName}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {invitation.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {getRoleLabel(role)}
            </Badge>
          ))}
        </div>
        <Button
          className="mt-6 w-full"
          disabled={acceptInvitation.isPending}
          onClick={() => {
            void accept().catch((err) =>
              toast.error(err instanceof ApiError ? err.message : 'Could not join. Try again.'),
            )
          }}
        >
          {acceptInvitation.isPending ? 'Joining…' : `Join ${orgName}`}
        </Button>
      </Shell>
    )
  }

  // --- State 1: nobody is signed in ------------------------------------------
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!invitation) return
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
      if (err instanceof ApiError) toast.error(err.message)
      else if (mode === 'create') toast.error('That account could not be created. Try signing in.')
      else toast.error('Could not sign in. Check the password and try again.')
      setSubmitting(false)
    }
  }

  return (
    <Shell>
      <h1 className="display text-2xl font-bold">Join {orgName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === 'create' ? `Create your ${APP_NAME} account.` : 'Sign in to accept.'}
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
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
          <Input
            id="joinPassword"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'create' && (
            <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
          )}
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Joining…' : `Join ${orgName}`}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === 'create' ? 'Already have an account? ' : 'Need an account? '}
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={() => setMode(mode === 'create' ? 'signIn' : 'create')}
        >
          {mode === 'create' ? 'Sign in' : 'Create one'}
        </button>
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
