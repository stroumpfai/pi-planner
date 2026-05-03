import { create } from 'zustand'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  isEditing: boolean
  setUser: (user: User | null) => void
  setIsEditing: (value: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isEditing: false,
  setUser: (user) => set({ user }),
  setIsEditing: (isEditing) => set({ isEditing }),
}))
