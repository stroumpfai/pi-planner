import { describe, it, expect } from 'vitest'
import { measureTextWidth } from '../measureText'

describe('measureTextWidth', () => {
  it('returns a numeric width and reuses the lazy measurer element', () => {
    const before = document.body.querySelectorAll('div').length

    const w1 = measureTextWidth('hello', 'text-sm')
    const w2 = measureTextWidth('a much longer string', 'text-sm')

    expect(typeof w1).toBe('number')
    expect(typeof w2).toBe('number')
    // Only one hidden measurer div is created and reused across calls.
    const after = document.body.querySelectorAll('div').length
    expect(after).toBe(before + 1)
  })

  it('applies the given className to the measurer', () => {
    measureTextWidth('x', 'my-measure-class')
    expect(document.querySelector('.my-measure-class')).not.toBeNull()
  })
})
