import { useState, type FormEvent } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { getFirebaseAuth } from '@/dependencies/firebase'
import { authErrorToMessage } from '@/lib/firebaseErrors'
import { passwordProblem } from '@/lib/passwordPolicy'
import { readHandoff, safeRedirect } from '@/lib/redirectTo'

export function SignUp() {
  const navigate = useNavigate()
  const location = useLocation()
  const handoff = readHandoff(location.state)

  const [email, setEmail] = useState(handoff.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    // Checked here as well as by the field, so the rule is the same sentence
    // whether the browser catches it or we do.
    const problem = passwordProblem(password)
    if (problem) return setError(problem)

    setSubmitting(true)
    try {
      await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password)
      // The server creates the User row on the first /auth/me call, so the app
      // lands on onboarding from here.
      navigate(safeRedirect(handoff.from, '/welcome'), { replace: true })
    } catch (err) {
      // Sign-up names the specific cause — "that email already has an account"
      // is the one thing that tells the reader what to do instead, and the
      // create would have failed anyway, so it discloses nothing new.
      setError(authErrorToMessage(err, 'signUp'))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="display mb-8 text-center text-2xl font-bold">Create your {APP_NAME} account</h1>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
            <PasswordInput
              id="password"
              required
              showRequirement
              autoComplete="new-password"
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
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            to="/auth/sign-in"
            // Carry both across, so switching screens never means retyping the
            // address or losing the invite that sent them here.
            state={handoff.from || email ? { from: handoff.from, email: email || undefined } : undefined}
            className="text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
