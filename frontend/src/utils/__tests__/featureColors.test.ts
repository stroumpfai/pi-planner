import { describe, it, expect } from 'vitest'
import { getFeatureColorIdx, lineageRootId, FEATURE_BORDER_COLORS } from '../featureColors'

type Node = { system_id: string; continued_from_feature_id: string | null }

const byIdOf = (nodes: Node[]) => new Map(nodes.map((n) => [n.system_id, n]))

describe('lineageRootId', () => {
  it('returns the id itself for a standalone / origin feature', () => {
    const byId = byIdOf([{ system_id: 'root', continued_from_feature_id: null }])
    expect(lineageRootId('root', byId)).toBe('root')
  })

  it('walks a multi-hop continuation chain up to the origin', () => {
    const byId = byIdOf([
      { system_id: 'root', continued_from_feature_id: null },
      { system_id: 'mid', continued_from_feature_id: 'root' },
      { system_id: 'leaf', continued_from_feature_id: 'mid' },
    ])
    expect(lineageRootId('leaf', byId)).toBe('root')
    expect(lineageRootId('mid', byId)).toBe('root')
    expect(lineageRootId('root', byId)).toBe('root')
  })

  it('falls back to the input id when the parent is not in the map (still loading)', () => {
    const byId = byIdOf([{ system_id: 'leaf', continued_from_feature_id: 'missing' }])
    expect(lineageRootId('leaf', byId)).toBe('leaf')
  })

  it('terminates on an accidental cycle', () => {
    const byId = byIdOf([
      { system_id: 'a', continued_from_feature_id: 'b' },
      { system_id: 'b', continued_from_feature_id: 'a' },
    ])
    // Should not loop forever; returns one of the nodes in the cycle.
    expect(['a', 'b']).toContain(lineageRootId('a', byId))
  })
})

describe('color consistency across a split feature', () => {
  it('every slice of a lineage resolves to the same palette color', () => {
    const byId = byIdOf([
      { system_id: 'root', continued_from_feature_id: null },
      { system_id: 'pi2', continued_from_feature_id: 'root' },
      { system_id: 'pi3', continued_from_feature_id: 'pi2' },
    ])
    const rootColor = getFeatureColorIdx(lineageRootId('root', byId))
    expect(getFeatureColorIdx(lineageRootId('pi2', byId))).toBe(rootColor)
    expect(getFeatureColorIdx(lineageRootId('pi3', byId))).toBe(rootColor)
    expect(rootColor).toBeGreaterThanOrEqual(0)
    expect(rootColor).toBeLessThan(FEATURE_BORDER_COLORS.length)
  })
})
