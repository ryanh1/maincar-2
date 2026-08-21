import { create } from 'zustand'
import type { User as FirebaseUser } from 'firebase/auth'

import type { Membership, Org, User } from '@/providers/authTypes'

interface AuthStoreState {
  firebaseUser: FirebaseUser | null
  user: User | null
  /** The org the session is acting in, or null when the user belongs to none. */
  org: Org | null
  /** Every org the user belongs to. Backs the org switcher and the admin gate. */
  memberships: Membership[]
  authLoading: boolean

  setAuthLoading: (authLoading: boolean) => void
  setFirebaseUser: (firebaseUser: FirebaseUser | null) => void
  setMe: (input: { user: User | null; org: Org | null; memberships?: Membership[] }) => void
  reset: () => void
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  firebaseUser: null,
  user: null,
  org: null,
  memberships: [],
  authLoading: true,

  setAuthLoading: (authLoading) => set({ authLoading }),
  setFirebaseUser: (firebaseUser) => set({ firebaseUser }),
  setMe: ({ user, org, memberships }) => set({ user, org, memberships: memberships ?? [] }),
  reset: () =>
    set({ firebaseUser: null, user: null, org: null, memberships: [], authLoading: false }),
}))
