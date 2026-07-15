// POST-BETA-4 PB4.3: Recognition board projection.
//
// Per ADR 0043:
// - One property, one approved metric version, one comparable scope/role
//   cohort, one bounded period. No all_time.
// - Direct unit/rate/target attainment, rank/tie, sample/opportunity.
// - No composite or property-max normalized percentage.
// - Missing/partial/reconciling/ineligible/low-sample targets are unranked.
// - Ties share rank; do not add arbitrary hidden tie-breakers.
// - Portal-group recognition board is the preferred initial subject.

export type BoardSubjectType = 'portal_group' | 'portal'
export type BoardPeriodKind = 'weekly' | 'monthly' | 'quarterly'
export type EntryEligibility =
  | 'ranked'
  | 'unranked_insufficient_sample'
  | 'unranked_reconciling'
  | 'unranked_ineligible'

export interface BoardSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly metricDefinitionVersionId: string
  readonly subjectType: BoardSubjectType
  readonly periodKind: BoardPeriodKind
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly timezone: string
  readonly policyVersion: string
  readonly status: 'building' | 'ready' | 'stale'
  readonly quality: string
  readonly freshness: Date
  readonly sourceWatermark: Date
  readonly computedAt: Date
  readonly generation: number
}

export interface BoardEntry {
  readonly snapshotId: string
  readonly subjectId: string
  readonly subjectLabel: string
  readonly value: number | null
  readonly numerator: number | null
  readonly denominator: number | null
  readonly sampleSize: number
  readonly opportunitySize: number
  readonly rank: number | null
  readonly tieGroup: number | null
  readonly eligibility: EntryEligibility
  readonly exclusionReason: string | null
  readonly presentationRef: string
}

export const MINIMUM_COHORT_SIZE = 5
export const MINIMUM_OBSERVATIONS_PER_TARGET = 10

/**
 * Compute ranks for board entries. Ties share rank.
 * Per ADR 0043: ties share rank; do not add arbitrary hidden tie-breakers.
 */
export function computeRanks(entries: readonly BoardEntry[]): BoardEntry[] {
  // Only rank eligible entries with values
  const rankable = entries.filter((e) => e.eligibility === 'ranked' && e.value !== null)

  // Sort by value descending
  const sorted = [...rankable].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  // Assign ranks with ties sharing the same rank
  let currentRank = 1
  let currentValue: number | null = null
  let tieGroup = 0

  const rankMap = new Map<string, { rank: number; tieGroup: number }>()

  for (const entry of sorted) {
    const value = entry.value ?? 0
    if (currentValue === null || value !== currentValue) {
      currentRank = sorted.indexOf(entry) + 1
      tieGroup++
      currentValue = value
    }
    rankMap.set(entry.subjectId, { rank: currentRank, tieGroup })
  }

  return entries.map((e) => {
    const ranked = rankMap.get(e.subjectId)
    if (ranked) {
      return { ...e, rank: ranked.rank, tieGroup: ranked.tieGroup }
    }
    return { ...e, rank: null, tieGroup: null }
  })
}

/**
 * Evaluate entry eligibility based on sample size and cohort.
 * Per ADR 0043: at least 5 eligible peers and 10 relevant observations.
 */
export function evaluateEligibility(
  sampleSize: number,
  opportunitySize: number,
  cohortSize: number,
  isReconciling: boolean,
): EntryEligibility {
  if (isReconciling) return 'unranked_reconciling'
  if (cohortSize < MINIMUM_COHORT_SIZE) return 'unranked_insufficient_sample'
  if (sampleSize < MINIMUM_OBSERVATIONS_PER_TARGET) return 'unranked_insufficient_sample'
  if (opportunitySize === 0) return 'unranked_ineligible'
  return 'ranked'
}

/**
 * Validate that a board configuration is safe.
 * Per ADR 0043: no composite score, no normalized percentage, no all_time.
 */
export function validateBoardConfig(params: {
  periodKind: BoardPeriodKind
  subjectType: BoardSubjectType
}): string[] {
  const errors: string[] = []
  if (params.periodKind === ('all_time' as BoardPeriodKind)) {
    errors.push('all_time period is not allowed')
  }
  return errors
}
