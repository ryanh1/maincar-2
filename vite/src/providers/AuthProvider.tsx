import { useEffect, useMemo, type ReactNode } from 'react'
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth'

import { getFirebaseAuth } from '@/dependencies/firebase'
import { useAuthStore } from '@/store/authStore'
import { meUrl } from '@/providers/useAuth'
import type { MeResponse } from '@/providers/authTypes'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Runs the `onAuthStateChanged` side effect and loads the profile into the store.
 * It renders its children unchanged — the state lives in zustand, so any component
 * reads it through `useAuth()` without a context round trip.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useMemo(() => getFirebaseAuth(), [])
  const setFirebaseUser = useAuthStore((s) => s.setFirebaseUser)
  const setMe = useAuthStore((s) => s.setMe)
  const setAuthLoading = useAuthStore((s) => s.setAuthLoading)

  useEffect(() => {
    let cancelled = false

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser)
      setMe({ user: null, org: null })
      setAuthLoading(true)

      try {
        if (!fbUser) return

        // getIdToken() returns a valid cached token and silently refreshes it near
        // expiry, so this stays fresh across the one-hour token life.
        const idToken = await fbUser.getIdToken()

        // Retry transient failures. ONLY a real rejection (401/403) signs the user
        // out — a network blip or a 5xx must not, or people get logged out at
        // random. The Firebase session survives either way, so a later reload
        // recovers the profile.
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          let res: Response
          try {
            res = await fetch(meUrl(), {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
            })
          } catch (netErr) {
            if (attempt === 2) {
              console.error('[AuthProvider] /auth/me network error, keeping session:', netErr)
              break
            }
            await sleep(500 * (attempt + 1))
            continue
          }

          if (res.ok) {
            const data = (await res.json()) as MeResponse
            if (!cancelled) setMe({ user: data.user, org: data.org })
            break
          }

          if (res.status === 401 || res.status === 403) {
            await firebaseSignOut(auth).catch(() => {})
            if (!cancelled) {
              setFirebaseUser(null)
              setMe({ user: null, org: null })
            }
            break
          }

          if (attempt === 2) {
            console.error('[AuthProvider] /auth/me failed, keeping session:', res.status)
            break
          }
          await sleep(500 * (attempt + 1))
        }
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [auth, setAuthLoading, setFirebaseUser, setMe])

  return <>{children}</>
}
