import { describe, it, expect, beforeEach } from 'vitest'
import { useDragStore } from '../dragStore'

beforeEach(() => useDragStore.setState({ draggingId: null, draggingType: null }))

describe('dragStore', () => {
  it('has null initial state', () => {
    const { draggingId, draggingType } = useDragStore.getState()
    expect(draggingId).toBeNull()
    expect(draggingType).toBeNull()
  })

  it('setDragging updates id and type', () => {
    useDragStore.getState().setDragging('f-1', 'feature')
    const { draggingId, draggingType } = useDragStore.getState()
    expect(draggingId).toBe('f-1')
    expect(draggingType).toBe('feature')
  })

  it('clearDragging resets both fields to null', () => {
    useDragStore.getState().setDragging('g-1', 'group')
    useDragStore.getState().clearDragging()
    const { draggingId, draggingType } = useDragStore.getState()
    expect(draggingId).toBeNull()
    expect(draggingType).toBeNull()
  })

  it('supports all dragging types', () => {
    const types = ['feature', 'pbi', 'group', 'swimline'] as const
    for (const type of types) {
      useDragStore.getState().setDragging('x', type)
      expect(useDragStore.getState().draggingType).toBe(type)
    }
  })
})
