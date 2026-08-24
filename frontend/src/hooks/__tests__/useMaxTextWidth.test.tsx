import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMaxTextWidth } from '../useMaxTextWidth'
import * as measure from '@/utils/measureText'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useMaxTextWidth', () => {
  it('returns the widest measured text, capped at maxWidth', () => {
    vi.spyOn(measure, 'measureTextWidth').mockImplementation((t: string) => t.length * 10)

    const { result } = renderHook(() => useMaxTextWidth(['ab', 'abcd'], 'cls', 1000))

    // widest is 'abcd' -> 40
    expect(result.current).toBe(40)
  })

  it('clamps the result to maxWidth', () => {
    vi.spyOn(measure, 'measureTextWidth').mockImplementation((t: string) => t.length * 100)

    const { result } = renderHook(() => useMaxTextWidth(['long text'], 'cls', 50))

    expect(result.current).toBe(50)
  })

  it('returns 0 for an empty list', () => {
    vi.spyOn(measure, 'measureTextWidth').mockReturnValue(123)

    const { result } = renderHook(() => useMaxTextWidth([], 'cls', 500))

    expect(result.current).toBe(0)
  })
})
