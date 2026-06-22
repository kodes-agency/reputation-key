// Leaderboard context — domain scoring functions
//
// Pure functions for normalization, ranking, and composite score computation.
// Extracted from the repository so domain logic lives in the domain layer, not
// infrastructure (LB-02). The repository queries raw metric rows and delegates
// all scoring math to these functions.

import type { LeaderboardMetricKey, LeaderboardRowInput } from './types'

/** Metrics that compose the "overall" score (all portal-level metrics except 'overall'). */
export const PORTAL_METRICS: readonly Exclude<LeaderboardMetricKey, 'overall'>[] = [
  'portal.rating',
  'portal.feedback',
  'portal.scan',
  'portal.review_link_click',
]

/** Composite weights for the "overall" score (must sum to 1.0).
 *  System-defined per CONTEXT.md invariant: 40% rating, 30% feedback, 20% scans, 10% clicks. */
export const OVERALL_WEIGHTS: Readonly<Record<string, number>> = {
  'portal.rating': 0.4,
  'portal.feedback': 0.3,
  'portal.scan': 0.2,
  'portal.review_link_click': 0.1,
}

/** A target with a raw metric value and a normalized score (0..1). */
export type ScoredTarget = Readonly<{
  row: LeaderboardRowInput
  value: number
  normalized: number
}>

/** A scored target with an assigned competition rank. */
export type RankedTarget = ScoredTarget & Readonly<{ rank: number }>

/** Stable key for a target within a scope (type:id). Used for cross-metric aggregation. */
export const targetKey = (row: LeaderboardRowInput): string =>
  `${row.targetType}:${row.targetId}`

/**
 * Property-scoped max-value normalization: each target's raw metric is divided
 * by the max in the set. Targets with no data get 0. (CONTEXT.md invariant.)
 */
export const normalize = (
  values: ReadonlyArray<ScoredTarget>,
): ReadonlyArray<ScoredTarget> => {
  const max = Math.max(...values.map((v) => v.value), 0)
  if (max <= 0) {
    return values.map((v) => ({ ...v, normalized: 0 }))
  }
  return values.map((v) => ({ ...v, normalized: v.value / max }))
}

/**
 * Compute composite "overall" scores from per-metric normalized scores.
 * Each target's overall score is the weighted sum of its normalized component
 * scores using OVERALL_WEIGHTS. (CONTEXT.md invariant.)
 *
 * @param targets - All targets in the scope (order preserved in output).
 * @param componentNormalized - Map from PORTAL_METRIC key → normalized scored targets.
 */
export const compositeScore = (
  targets: ReadonlyArray<LeaderboardRowInput>,
  componentNormalized: ReadonlyMap<string, ReadonlyArray<ScoredTarget>>,
): ReadonlyArray<ScoredTarget> => {
  const targetScores = new Map<string, number>()

  for (const [metricKey, scored] of componentNormalized) {
    const weight = OVERALL_WEIGHTS[metricKey] ?? 0
    for (const s of scored) {
      const key = targetKey(s.row)
      targetScores.set(key, (targetScores.get(key) ?? 0) + weight * s.normalized)
    }
  }

  return targets.map((row) => ({
    row,
    value: 0,
    normalized: targetScores.get(targetKey(row)) ?? 0,
  }))
}

/**
 * Sort targets by normalized score (desc), then by raw metric value (desc) for
 * display stability, and assign standard competition ranks: equal normalized
 * scores share the same rank; the next rank skips (1,1,3,3,5).
 *
 * The secondary sort by raw value is for display ordering only and does NOT
 * break ties (per CONTEXT.md invariant).
 */
export const rank = (
  values: ReadonlyArray<ScoredTarget>,
): ReadonlyArray<RankedTarget> => {
  const sorted = [...values].sort((a, b) => {
    if (b.normalized !== a.normalized) return b.normalized - a.normalized
    return b.value - a.value
  })

  let currentRank = 0
  let prevNormalized: number | null = null

  return sorted.map((value, index) => {
    if (prevNormalized === null || value.normalized !== prevNormalized) {
      currentRank = index + 1
      prevNormalized = value.normalized
    }
    return { ...value, rank: currentRank }
  })
}
