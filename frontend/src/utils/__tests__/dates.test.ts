import { describe, it, expect } from 'vitest'
import { fmtDateTime } from '../dates'

describe('fmtDateTime', () => {
  it('returns the default fallback for missing values', () => {
    expect(fmtDateTime(null)).toBe('—')
    expect(fmtDateTime(undefined)).toBe('—')
    expect(fmtDateTime('')).toBe('—')
  })

  it('returns a custom fallback when given one', () => {
    expect(fmtDateTime(null, 'Never')).toBe('Never')
  })

  // The exact wall clock depends on the runner's TZ, so assert the shape rather
  // than the full locale string. The correctness of the UTC offset is pinned by
  // the backend serialization test.
  it('formats an ISO datetime as date plus time', () => {
    const formatted = fmtDateTime('2026-08-17T16:05:00+00:00')
    expect(formatted).toContain('2026')
    expect(formatted).toMatch(/\d{1,2}:\d{2}/)
  })

  it('accepts a Z-suffixed datetime', () => {
    expect(fmtDateTime('2026-08-17T16:05:00Z')).toContain('2026')
  })
})
