import { create } from 'zustand'
import type { User as FirebaseUser } from 'firebase/auth'

import type { Org, User } from '@/providers/authTypes'

interface AuthStoreState {
  firebaseUser: FirebaseUser | null
  user: User | null
  org: Org | null
  authLoading: boolean

  setAuthLoading: (authLoading: boolean) => void
  setFirebaseUser: (firebaseUser: FirebaseUser | null) => void
  setMe: (input: { user: User | null; org: Org | null }) => void
  reset: () => void
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  firebaseUser: null,
  user: null,
  org: null,
  authLoading: true,

  setAuthLoading: (authLoading) => set({ authLoading }),
  setFirebaseUser: (firebaseUser) => set({ firebaseUser }),
  setMe: ({ user, org }) => set({ user, org }),
  reset: () => set({ firebaseUser: null, user: null, org: null, authLoading: false }),
}))
