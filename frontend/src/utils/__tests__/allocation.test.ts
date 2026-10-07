import type { MemberLoad, TeamAssignment } from '@/types'
import {
  NEW_ALLOCATION,
  allocationFields,
  allocationOf,
  remainingOption,
  type Allocation,
} from '@/utils/allocation'

const ORDER = ['m-1', 'm-2']
const nameOf = (id: string) => ({ 'm-1': 'Anna', 'm-2': 'Bruno' })[id] ?? id

const assignment = (over: Partial<TeamAssignment> = {}): TeamAssignment =>
  ({
    project_id: 'p-1',
    project_name: 'Portal',
    share_pct: 100,
    share_days: null,
    all_members: true,
    member_ids: [],
    member_shares: [],
    remaining: false,
    ...over,
  }) as TeamAssignment

const load = (member_id: string, contracted_days = 5): MemberLoad => ({
  member_id,
  name: nameOf(member_id),
  share_pct: 0,
  days_per_week: 0,
  contracted_days,
  remaining_days: contracted_days,
})

const some = (shares: Allocation['shares']): Allocation => ({
  ...NEW_ALLOCATION,
  mode: 'some',
  memberIds: Object.keys(shares),
  shares,
})

describe('allocationFields', () => {
  it('stores a share in days on the assignment when every member has it', () => {
    const result = allocationFields(
      some({ 'm-1': { unit: 'days', value: '2' }, 'm-2': { unit: 'days', value: '2.0' } }),
      ORDER,
      nameOf,
    )
    expect(result).toEqual({
      ok: true,
      fields: { share_days: 2, all_members: false, member_ids: ['m-1', 'm-2'], member_shares: [] },
    })
  })

  it('keeps every member who differs from 100% as a share of their own', () => {
    const result = allocationFields(
      some({ 'm-1': { unit: 'pct', value: '100' }, 'm-2': { unit: 'pct', value: '40' } }),
      ORDER,
      nameOf,
    )
    expect(result).toEqual({
      ok: true,
      fields: {
        share_pct: 100,
        all_members: false,
        member_ids: ['m-1', 'm-2'],
        member_shares: [{ member_id: 'm-2', share_pct: 40 }],
      },
    })
  })

  it('refuses a whole team without a share', () => {
    const result = allocationFields({ ...NEW_ALLOCATION, team: { unit: 'pct', value: '' } }, ORDER, nameOf)
    expect(result).toEqual({ ok: false, error: 'Give the team a share.' })
  })

  it('sends only the flag for the remaining capacity', () => {
    expect(allocationFields({ ...NEW_ALLOCATION, mode: 'remaining' }, ORDER, nameOf)).toEqual({
      ok: true,
      fields: { remaining: true },
    })
  })

  it('gives back the same fields for an assignment saved unchanged', () => {
    const stored = assignment({ share_pct: 60, all_members: false, member_ids: ['m-1', 'm-2'] })
    expect(allocationFields(allocationOf(stored), ORDER, nameOf)).toEqual({
      ok: true,
      fields: { share_pct: 60, all_members: false, member_ids: ['m-1', 'm-2'], member_shares: [] },
    })
  })
})

describe('remainingOption', () => {
  it('leaves each member what the other projects do not book', () => {
    const portal = assignment({ all_members: false, member_ids: ['m-1'] })
    const billing = assignment({
      project_id: 'p-2',
      share_pct: 50,
      member_shares: [{ member_id: 'm-2', share_pct: null, share_days: 1 }],
    })
    const option = remainingOption([portal, billing], [load('m-1'), load('m-2', 4)])

    expect(option.enabled && option.leftovers.map((l) => [l.memberId, l.days])).toEqual([
      ['m-1', 0],
      ['m-2', 3],
    ])
  })

  it('stays on for the project that already holds it', () => {
    const rest = assignment({ remaining: true })
    expect(remainingOption([rest], [load('m-1')], 'p-1').enabled).toBe(true)
  })
})
