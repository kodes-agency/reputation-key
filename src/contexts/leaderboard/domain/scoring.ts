// Leaderboard context — domain scoring functions
//
// Pure functions for normalization and ranking. Extracted from the repository
// so domain logic lives in the domain layer, not infrastructure (LB-02). The
// repository queries raw metric rows and delegates all scoring math here.

import type { LeaderboardMetricKey, LeaderboardRowInput } from './types'

/** The portal-level metrics the leaderboard ranks. Property-scoped metrics
 *  (e.g. property.review) cannot differentiate portals and are excluded. */
export const LEADERBOARD_METRICS: readonly LeaderboardMetricKey[] = [
  'portal.rating',
  'portal.feedback',
  'portal.scan',
  'portal.review_link_click',
]

/** Minimum private ratings a target must collect in a period to be ranked on
 *  the average-rating metric. Below this the average is statistically unstable
 *  (a single 5★ would otherwise top the board). Count metrics have no floor. */
export const RATING_FLOOR = 5

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
