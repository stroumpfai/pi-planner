import { describeCounted, fmtDays, formatLoad, formatShare, shareFields } from '../shares'

const names: Record<string, string> = { 'm-1': 'Anna', 'm-2': 'Bruno' }
const nameOf = (id: string) => names[id] ?? '…'

describe('shares', () => {
  it('shows a share the way it was entered', () => {
    expect(formatShare(70, null)).toBe('70%')
    expect(formatShare(70, 2)).toBe('2 d/wk')
    expect(formatShare(100, 2.5)).toBe('2.5 d/wk')
  })

  it('writes days without float noise', () => {
    expect(fmtDays(2)).toBe('2')
    expect(fmtDays(4.333)).toBe('4.3')
  })

  it('shows a load as a percentage and in days of the contract', () => {
    expect(
      formatLoad({ member_id: 'm-1', name: 'Anna', share_pct: 119.6, days_per_week: 6, contracted_days: 5 }),
    ).toBe('120% · 6 of 5 d/wk')
  })

  it('sends one unit, never both', () => {
    expect(shareFields('pct', '40')).toEqual({ share_pct: 40 })
    expect(shareFields('days', '2.5')).toEqual({ share_days: 2.5 })
  })

  describe('describeCounted', () => {
    it('says nothing for a whole team at the assignment share', () => {
      expect(describeCounted(true, [], [], nameOf)).toBeNull()
    })

    it('names whoever has a share of their own on a whole-team project', () => {
      expect(describeCounted(true, [], [{ member_id: 'm-1', share_days: 2 }], nameOf)).toBe(
        'whole team · Anna 2 d/wk',
      )
    })

    it('lists a scoped project, with own shares inline', () => {
      expect(
        describeCounted(false, ['m-1', 'm-2'], [{ member_id: 'm-2', share_pct: 40 }], nameOf),
      ).toBe('Anna, Bruno 40%')
    })

    it('says so when a scoped project counts nobody', () => {
      expect(describeCounted(false, [], [], nameOf)).toBe('nobody — no capacity')
    })
  })
})
