import { useState, type FormEvent } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { APP_NAME, APP_SLOGAN } from '@/config'
import { AuthCard } from '@/components/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { getFirebaseAuth } from '@/dependencies/firebase'
import { authErrorToMessage } from '@/lib/firebaseErrors'
import { readHandoff, safeRedirect } from '@/lib/redirectTo'

export function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()

  // Whoever sent the person here can say where they belong afterwards — an invite
  // link, or a protected route they asked for before signing in.
  const handoff = readHandoff(location.state)

  const [email, setEmail] = useState(handoff.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password)
      navigate(safeRedirect(handoff.from, '/home'), { replace: true })
    } catch (err) {
      // `authErrorToMessage(err, 'signIn')` answers "no account here" and "wrong
      // password" with the SAME sentence on purpose. Telling them apart would let
      // anyone use this form to find out which addresses have accounts.
      setError(authErrorToMessage(err, 'signIn'))
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      title={APP_NAME}
      subtitle={APP_SLOGAN}
      footer={
        <>
          Do not have an account?{' '}
          <Link
            to="/auth/sign-up"
            // Carry both across, so switching screens never means retyping the
            // address or losing the invite that sent them here.
            state={handoff.from || email ? { from: handoff.from, email: email || undefined } : undefined}
            className="text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">
            Email <RequiredAsterisk />
          </Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">
            Password <RequiredAsterisk />
          </Label>
          {/* No rule shown here: this password already exists, so a rule would
              only be something to fail against. */}
          <PasswordInput
            id="password"
            required
            autoComplete="current-password"
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
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  )
}
