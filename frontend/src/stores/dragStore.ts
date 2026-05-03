import { create } from 'zustand'

interface DragState {
  draggingId: string | null
  draggingType: 'feature' | 'pbi' | 'group' | 'swimline' | null
  setDragging: (id: string, type: DragState['draggingType']) => void
  clearDragging: () => void
}

export const useDragStore = create<DragState>((set) => ({
  draggingId: null,
  draggingType: null,
  setDragging: (id, type) => set({ draggingId: id, draggingType: type }),
  clearDragging: () => set({ draggingId: null, draggingType: null }),
}))
