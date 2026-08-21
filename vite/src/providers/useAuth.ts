import { useMemo } from 'react'
import { signOut as firebaseSignOut, type User as FirebaseUser } from 'firebase/auth'
import { useQueryClient } from '@tanstack/react-query'

import { API_URL } from '@/config'
import { getFirebaseAuth } from '@/dependencies/firebase'
import { isAdmin as rolesIsAdmin, isSuperadmin as rolesIsSuperadmin } from '@/lib/roles'
import { useAuthStore } from '@/store/authStore'
import type { Membership, MeResponse, Org, User } from '@/providers/authTypes'

/**
 * Kept apart from `AuthProvider.tsx` on purpose: a module that exports both a
 * component and a non-component breaks fast refresh and trips
 * `eslint-plugin-react-refresh`. Same reasoning as `buttonVariants.ts`.
 *
 * `AuthProvider` owns the side effect (onAuthStateChanged → the store). This hook
 * is the read side, plus the two actions that change auth state.
 */
export interface AuthContextType {
  user: User | null
  org: Org | null
  /** Every org the user belongs to, with their roles in each. */
  memberships: Membership[]
  firebaseUser: FirebaseUser | null
  isLoading: boolean
  isAuthenticated: boolean
  /** Admin OF THE ACTIVE ORG. A user can be an admin here and a member elsewhere. */
  isAdmin: boolean
  isSuperadmin: boolean
  needsOnboarding: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export function meUrl(): string {
  return API_URL ? `${API_URL}/api/auth/me` : '/api/auth/me'
}

export function useAuth(): AuthContextType {
  const auth = useMemo(() => getFirebaseAuth(), [])
  const queryClient = useQueryClient()

  const firebaseUser = useAuthStore((s) => s.firebaseUser)
  const user = useAuthStore((s) => s.user)
  const org = useAuthStore((s) => s.org)
  const memberships = useAuthStore((s) => s.memberships)
  const isLoading = useAuthStore((s) => s.authLoading)
  const setAuthLoading = useAuthStore((s) => s.setAuthLoading)
  const setMe = useAuthStore((s) => s.setMe)

  // "Admin" is per-org: the gate is the caller's membership in the org the session
  // is acting in, NOT `user.roles` (those are global platform roles). Reading the
  // wrong one would show org settings to a member who only runs a different org.
  const activeRoles = memberships.find((m) => m.orgId === org?.id)?.roles ?? []
  const isAdmin = rolesIsAdmin(activeRoles)

  // The onboarding gate. Limited to what a fresh signup cannot have:
  //   1. Profile (first name, last name) — everyone.
  //   2. Org name — admins only; everyone else inherits it from their inviter.
  const needsProfileSetup = !user?.firstName || !user?.lastName
  const needsOrgSetup = isAdmin && !org?.name
  const needsOnboarding = !!user && !!org && (needsProfileSetup || needsOrgSetup)

  const refresh = async (): Promise<void> => {
    if (!auth.currentUser) return
    setAuthLoading(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(meUrl(), {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      })
      if (!res.ok) throw new Error('Failed to refresh user')
      const data = (await res.json()) as MeResponse
      setMe({ user: data.user, org: data.org, memberships: data.memberships })
    } finally {
      setAuthLoading(false)
    }
  }

  const signOut = async (): Promise<void> => {
    await firebaseSignOut(auth)
    setMe({ user: null, org: null, memberships: [] })
    // The cache is cleared HERE and nowhere else, so a second account can never
    // read the first one's data (CLAUDE.md → Cache Management).
    queryClient.clear()
  }

  return {
    user,
    org,
    memberships,
    firebaseUser,
    isLoading,
    isAuthenticated: !!firebaseUser,
    isAdmin,
    isSuperadmin: rolesIsSuperadmin(user?.roles ?? []),
    needsOnboarding,
    refresh,
    signOut,
  }
}
