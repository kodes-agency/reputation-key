// Leaderboard context — domain scoring function tests (LB-02)

import { describe, it, expect } from 'vitest'
import {
  normalize,
  rank,
  compositeScore,
  targetKey,
  PORTAL_METRICS,
  OVERALL_WEIGHTS,
  type ScoredTarget,
} from './scoring'
import type { LeaderboardRowInput } from './types'

const row = (
  id: string,
  targetType: 'portal' | 'portal_group' = 'portal',
): LeaderboardRowInput => ({
  organizationId: 'org-1' as never,
  propertyId: 'prop-1' as never,
  targetType,
  targetId: id as never,
  portalId: targetType === 'portal' ? (id as never) : undefined,
  portalGroupId: targetType === 'portal_group' ? (id as never) : undefined,
  metricValue: 0,
})

const scored = (r: LeaderboardRowInput, value: number, normalized = 0): ScoredTarget => ({
  row: r,
  value,
  normalized,
})

describe('PORTAL_METRICS and OVERALL_WEIGHTS', () => {
  it('PORTAL_METRICS lists 4 portal metrics excluding overall', () => {
    expect(PORTAL_METRICS).toHaveLength(4)
    expect(PORTAL_METRICS).not.toContain('overall')
  })

  it('OVERALL_WEIGHTS sums to 1.0', () => {
    const sum = Object.values(OVERALL_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 10)
  })
})

describe('targetKey', () => {
  it('produces type:id string', () => {
    expect(targetKey(row('abc'))).toBe('portal:abc')
    expect(targetKey(row('xyz', 'portal_group'))).toBe('portal_group:xyz')
  })
})

describe('normalize', () => {
  it('divides each value by the max', () => {
    const values = [scored(row('a'), 10), scored(row('b'), 5), scored(row('c'), 0)]
    const result = normalize(values)
    expect(result[0].normalized).toBe(1)
    expect(result[1].normalized).toBe(0.5)
    expect(result[2].normalized).toBe(0)
  })

  it('returns all zeros when max is 0', () => {
    const values = [scored(row('a'), 0), scored(row('b'), 0)]
    const result = normalize(values)
    expect(result.every((v) => v.normalized === 0)).toBe(true)
  })

  it('handles empty array', () => {
    expect(normalize([])).toEqual([])
  })
})

describe('rank', () => {
  it('assigns standard competition ranks with equal-rank', () => {
    const values = [
      scored(row('a'), 10, 1.0),
      scored(row('b'), 8, 1.0),
      scored(row('c'), 5, 0.5),
      scored(row('d'), 3, 0.5),
      scored(row('e'), 0, 0),
    ]
    const result = rank(values)
    // a,b share rank 1 (normalized 1.0, a first by value); c,d share rank 3; e is rank 5
    expect(result.map((r) => r.rank)).toEqual([1, 1, 3, 3, 5])
  })

  it('sorts by normalized desc, then value desc', () => {
    const values = [
      scored(row('low'), 1, 0.1),
      scored(row('high'), 10, 1.0),
      scored(row('mid'), 5, 0.5),
    ]
    const result = rank(values)
    expect(result.map((r) => r.row.targetId)).toEqual(['high', 'mid', 'low'])
  })

  it('secondary sort by value breaks display order but not rank', () => {
    const values = [scored(row('a'), 5, 0.5), scored(row('b'), 8, 0.5)]
    const result = rank(values)
    // Same normalized (0.5) → same rank, but b comes first by value
    expect(result[0].row.targetId).toBe('b')
    expect(result[1].row.targetId).toBe('a')
    expect(result[0].rank).toBe(1)
    expect(result[1].rank).toBe(1)
  })
})

describe('compositeScore', () => {
  it('computes weighted sum of normalized component scores', () => {
    const targets = [row('a'), row('b')]

    // rating: a=1.0, b=0.5 (weight 0.4)
    // feedback: a=0.5, b=1.0 (weight 0.3)
    // Expected: a = 0.4*1.0 + 0.3*0.5 = 0.55; b = 0.4*0.5 + 0.3*1.0 = 0.50
    const component = new Map<string, ReadonlyArray<ScoredTarget>>([
      ['portal.rating', [scored(row('a'), 10, 1.0), scored(row('b'), 5, 0.5)]],
      ['portal.feedback', [scored(row('a'), 5, 0.5), scored(row('b'), 10, 1.0)]],
    ])

    const result = compositeScore(targets, component)
    expect(result).toHaveLength(2)
    expect(result[0].row.targetId).toBe('a')
    expect(result[0].normalized).toBeCloseTo(0.55, 10)
    expect(result[1].row.targetId).toBe('b')
    expect(result[1].normalized).toBeCloseTo(0.5, 10)
    // Raw value is 0 for composite (no single metric value)
    expect(result[0].value).toBe(0)
  })

  it('returns 0 normalized for targets with no component data', () => {
    const targets = [row('a'), row('b')]
    const component = new Map<string, ReadonlyArray<ScoredTarget>>([
      ['portal.rating', [scored(row('a'), 10, 1.0)]],
    ])
    const result = compositeScore(targets, component)
    expect(result[1].normalized).toBe(0)
  })
})
