import { create } from 'zustand'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  isEditing: boolean
  setUser: (user: User | null) => void
  setIsEditing: (value: boolean) => void
  isAdmin: () => boolean
  canEdit: () => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isEditing: false,
  setUser: (user) => set({ user }),
  setIsEditing: (isEditing) => set({ isEditing }),
  isAdmin: () => get().user?.role === 'admin',
  canEdit: () => get().user?.role !== 'reader',
}))
