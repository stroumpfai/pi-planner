import { fmt1, sprintDateRange, sprintLabel } from '../sprintLabels'

describe('sprintLabel', () => {
  it('numbers sprints from 1, matching the board', () => {
    expect(sprintLabel('Q3-2026', 4)).toBe('Q3-2026.4')
  })

  it('truncates the PI name and never the sprint number', () => {
    // The number is the half that tells adjacent columns apart (teams.md §7.0.1).
    const label = sprintLabel('Release train 2026 H2', 5)
    expect(label.endsWith('.5')).toBe(true)
    expect(label).toBe('Release tra….5')
  })

  it('leaves a short PI name alone', () => {
    expect(sprintLabel('8', 1)).toBe('8.1')
  })
})

describe('sprintDateRange', () => {
  it('collapses a range inside one month', () => {
    expect(sprintDateRange('2026-04-06', '2026-04-17')).toBe('6–17 Apr')
  })

  it('names both months when a sprint spans them', () => {
    expect(sprintDateRange('2026-04-20', '2026-05-01')).toBe('20 Apr – 1 May')
  })

  it('reads "—" when either date is missing', () => {
    // An undated sprint is unknown, not empty (§5.3).
    expect(sprintDateRange('2026-04-06', null)).toBe('—')
    expect(sprintDateRange(null, null)).toBe('—')
  })
})

describe('fmt1', () => {
  it('shows one decimal, which is all a capacity figure is displayed to', () => {
    expect(fmt1(55.2)).toBe('55.2')
    expect(fmt1(6.749)).toBe('6.7')
    expect(fmt1(8)).toBe('8.0')
  })

  it('is display only — the rounding that changes a stored value is the push', () => {
    // Nothing here feeds a write. The one rounding that reaches a sprint header
    // happens server-side, half-up, at the push boundary (teams.md §6.4).
    expect(fmt1(13.808)).toBe('13.8')
  })
})
