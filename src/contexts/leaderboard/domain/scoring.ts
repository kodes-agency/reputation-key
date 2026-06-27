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

// ── Comparison matrix ───────────────────────────────────────────────────

/** One cell in the comparison matrix: a single target × a single metric. */
export type MatrixCell = Readonly<{
  metricKey: LeaderboardMetricKey
  /** Raw value: average for rating (even if insufficient), sum for counts. */
  value: number
  /** Per-column competition rank (1 = best); null when insufficient or no data. */
  rank: number | null
  /** True only for portal.rating with fewer than RATING_FLOOR samples. */
  insufficient: boolean
}>

/** A target (portal or portal group) with its display name. */
export type MatrixTarget = LeaderboardRowInput & Readonly<{ targetName: string }>

/** A matrix row: the target plus one cell per ranked metric. */
export type MatrixRow = Readonly<{
  target: MatrixTarget
  cells: ReadonlyArray<MatrixCell>
}>

/** Raw aggregate for one target × one metric, straight from the readings. */
export type MetricAggregate = Readonly<{ sum: number; count: number }>

/**
 * Build the comparison matrix from raw per-target-per-metric aggregates.
 *
 * - portal.rating value is the average; targets with < RATING_FLOOR samples are
 *   "insufficient" (rank null, shown as "—"). Count metrics use the sum and are
 *   never insufficient.
 * - Each metric column is ranked independently by raw value (desc), standard
 *   competition ranking. Insufficient / no-data cells get rank null.
 * - Rows sort by the rating column rank ascending (worst-first); targets with no
 *   rankable rating sort last, then by name.
 */
export function buildMatrix(
  targets: ReadonlyArray<MatrixTarget>,
  aggregates: ReadonlyMap<string, ReadonlyMap<LeaderboardMetricKey, MetricAggregate>>,
): ReadonlyArray<MatrixRow> {
  const cellsByTarget = new Map<string, MatrixCell[]>()

  for (const metricKey of LEADERBOARD_METRICS) {
    const isRating = metricKey === 'portal.rating'

    // Rank only targets that have data and (for ratings) meet the floor.
    const rankable: ReadonlyArray<ScoredTarget> = targets
      .map((t) => {
        const agg = aggregates.get(targetKey(t))?.get(metricKey) ?? { sum: 0, count: 0 }
        const insufficient = isRating && agg.count < RATING_FLOOR
        const hasData = isRating ? agg.count > 0 : agg.sum > 0
        const value = isRating ? (agg.count > 0 ? agg.sum / agg.count : 0) : agg.sum
        return { row: t, value, normalized: value, _skip: !hasData || insufficient }
      })
      .filter((s) => !s._skip)
      .map(({ _skip, ...rest }) => rest)

    const rankByKey = new Map(rank(rankable).map((r) => [targetKey(r.row), r.rank]))

    for (const t of targets) {
      const agg = aggregates.get(targetKey(t))?.get(metricKey) ?? { sum: 0, count: 0 }
      const insufficient = isRating && agg.count < RATING_FLOOR
      const hasData = isRating ? agg.count > 0 : agg.sum > 0
      const value = isRating ? (agg.count > 0 ? agg.sum / agg.count : 0) : agg.sum
      const cellRank =
        hasData && !insufficient ? (rankByKey.get(targetKey(t)) ?? null) : null
      const arr = cellsByTarget.get(targetKey(t)) ?? []
      arr.push({ metricKey, value, rank: cellRank, insufficient })
      cellsByTarget.set(targetKey(t), arr)
    }
  }

  const rows: MatrixRow[] = targets.map((t) => ({
    target: t,
    cells: cellsByTarget.get(targetKey(t)) ?? [],
  }))

  const ratingRank = (row: MatrixRow): number | null =>
    row.cells.find((c) => c.metricKey === 'portal.rating')?.rank ?? null

  return rows.sort((a, b) => {
    const ra = ratingRank(a)
    const rb = ratingRank(b)
    if (ra === null && rb !== null) return 1
    if (rb === null && ra !== null) return -1
    if (ra !== null && rb !== null && ra !== rb) return rb - ra
    return a.target.targetName.localeCompare(b.target.targetName)
  })
}
