import { monthlyAchievedPd } from '../achievementMinimap'
import { monthsFrom } from '../timelineMonths'
import type { CapacitySprint } from '@/types'

const sprint = (over: Partial<CapacitySprint> = {}): CapacitySprint => ({
  sprint_id: 's-1',
  pi_id: 'pi-1',
  pi_name: 'Q3-2026',
  pi_state: 'draft',
  sprint_number: 1,
  label: 'Q3-2026.1',
  start_date: '2026-07-06',
  end_date: '2026-07-17',
  computable: true,
  available: 12,
  ...over,
})

describe('monthlyAchievedPd', () => {
  const months = monthsFrom({ year: 2026, month: 6 }, 3)

  it('puts a sprint inside one month wholly on that month', () => {
    expect(monthlyAchievedPd([sprint()], [12], months)).toEqual([0, 12, 0])
  })

  it('splits a sprint straddling a month end by its days', () => {
    // 29 Jun – 8 Jul: 2 days in June, 8 in July.
    const straddling = sprint({ start_date: '2026-06-29', end_date: '2026-07-08' })
    const [june, july, august] = monthlyAchievedPd([straddling], [10], months)
    expect(june).toBeCloseTo(2)
    expect(july).toBeCloseTo(8)
    expect(august).toBe(0)
  })

  it('adds nothing for an undated sprint or an unknown figure', () => {
    const undated = sprint({ start_date: null, end_date: null })
    expect(monthlyAchievedPd([undated, sprint()], [5, null], months)).toEqual([0, 0, 0])
  })
})
