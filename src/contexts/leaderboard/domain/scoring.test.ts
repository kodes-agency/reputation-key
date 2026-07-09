// Leaderboard context — domain scoring function tests (LB-02)

import { describe, it, expect } from 'vitest'
import {
  normalize,
  rank,
  targetKey,
  buildMatrix,
  LEADERBOARD_METRICS,
  RATING_FLOOR,
  type ScoredTarget,
  type MatrixTarget,
  type MetricAggregate,
} from './scoring'
import type { LeaderboardRowInput, LeaderboardMetricKey } from './types'
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

describe('LEADERBOARD_METRICS', () => {
  it('lists the 4 portal-level ranked metrics', () => {
    expect(LEADERBOARD_METRICS).toHaveLength(4)
    expect(LEADERBOARD_METRICS).not.toContain('property.review')
  })
})

describe('RATING_FLOOR', () => {
  it('is 5', () => {
    expect(RATING_FLOOR).toBe(5)
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

describe('buildMatrix', () => {
  const mt = (id: string, name: string): MatrixTarget => ({
    ...row(id),
    targetName: name,
  })
  const agg = (
    entries: Array<[LeaderboardMetricKey, MetricAggregate]>,
  ): ReadonlyMap<LeaderboardMetricKey, MetricAggregate> => new Map(entries)

  it('ranks columns independently, floors rating, sorts worst-first with nulls last', () => {
    const targets = [mt('a', 'A'), mt('b', 'B'), mt('c', 'C')]
    // rating: a=4.0 (5 ratings), b=4.0 but 1 rating (insufficient), c=5.0 (5 ratings)
    // scans:  a=10, b=20, c=5
    const aggregates = new Map([
      [
        'portal:a',
        agg([
          ['portal.rating', { sum: 20, count: 5 }],
          ['portal.scan', { sum: 10, count: 10 }],
        ]),
      ],
      [
        'portal:b',
        agg([
          ['portal.rating', { sum: 4, count: 1 }],
          ['portal.scan', { sum: 20, count: 20 }],
        ]),
      ],
      [
        'portal:c',
        agg([
          ['portal.rating', { sum: 25, count: 5 }],
          ['portal.scan', { sum: 5, count: 5 }],
        ]),
      ],
    ])
    const matrix = buildMatrix(targets, aggregates)

    // rating ranks: c=1 (5.0), a=2 (4.0), b=null (insufficient). Worst-first desc, nulls last.
    expect(matrix.map((r) => r.target.targetId)).toEqual(['a', 'c', 'b'])

    const cell = (id: string, key: LeaderboardMetricKey) =>
      matrix
        .find((r) => r.target.targetId === id)!
        .cells.find((c) => c.metricKey === key)!
    expect(cell('b', 'portal.rating').insufficient).toBe(true)
    expect(cell('b', 'portal.rating').rank).toBeNull()
    expect(cell('a', 'portal.rating').rank).toBe(2)
    expect(cell('c', 'portal.rating').rank).toBe(1)
    // scans ranked independently: b=1 (20), a=2 (10), c=3 (5)
    expect(cell('a', 'portal.scan').rank).toBe(2)
    expect(cell('b', 'portal.scan').rank).toBe(1)
    expect(cell('c', 'portal.scan').rank).toBe(3)
    // every row has one cell per ranked metric
    expect(matrix[0].cells).toHaveLength(LEADERBOARD_METRICS.length)
  })
})
