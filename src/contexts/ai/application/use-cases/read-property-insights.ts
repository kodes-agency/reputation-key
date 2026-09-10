import type {
  AiReviewSourcePort,
  AiTrendPopulationReview,
} from '#/contexts/review/application/public-api'
import { ASPECT_IMPACT_VERSION, computeAspectImpact } from '#/shared/aspect-impact'
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { resolveAiReadGate } from '../ai-read-gate'
import { addDays } from '../local-date'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyAnalyzedReview,
  AiPropertyUnavailableReview,
} from '../ports/ai-property-aggregate-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'

export const PROPERTY_INSIGHTS_RANGES = [30, 90, 180, 'all'] as const
export type PropertyInsightsRange = (typeof PROPERTY_INSIGHTS_RANGES)[number]

export function isPropertyInsightsRange(value: unknown): value is PropertyInsightsRange {
  return PROPERTY_INSIGHTS_RANGES.some((candidate) => candidate === value)
}

export type AiPropertyInsightsRatingBucket = Readonly<{
  stars: 1 | 2 | 3 | 4 | 5
  count: number
}>

export type AiPropertyInsightsBasis = Readonly<{
  reviewCount: number
  /** Ready analyses whose aspects contribute to this report. */
  analyzedReviewCount: number
  /** Ready and unavailable current analyses, for explicit coverage reporting. */
  currentAnalysisCount: number
  starOnlyCount: number
  notAnalyzableCount: number
  awaitingAnalysisCount: number
  ratingDistribution: readonly AiPropertyInsightsRatingBucket[]
}>

export type AiPropertyInsightAspect = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  mentionCount: number
  impact: number
  comparison: Readonly<{
    precedingMentionCount: number
    precedingImpact: number
    mentionCountDelta: number
    impactDelta: number
  }> | null
}>

export type AiPropertyInsightWeeklyPoint = Readonly<{
  weekStartLocalDate: string
  mentionCount: number
}>

export type AiPropertyInsightWeeklySeries = Readonly<{
  aspect: AspectTaxonomyV1Id
  points: readonly AiPropertyInsightWeeklyPoint[]
}>

export type AiPropertyInsightIssue = Readonly<{
  label: string
  count: number
  comparison: Readonly<{
    precedingCount: number
    delta: number
  }> | null
}>

export type AiPropertyInsightsRead =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{
      status: 'insufficient_data'
      startLocalDate: string | null
      endLocalDate: string
    }>
  | Readonly<{
      status: 'ready'
      range: PropertyInsightsRange
      startLocalDate: string
      endLocalDate: string
      precedingPeriod: Period | null
      dataThroughLocalDate: string
      impactVersion: typeof ASPECT_IMPACT_VERSION
      basis: AiPropertyInsightsBasis
      aspects: readonly AiPropertyInsightAspect[]
      weeklyAspectSeries: readonly AiPropertyInsightWeeklySeries[]
      emergingIssues: readonly AiPropertyInsightIssue[]
    }>

export type ReadPropertyInsightsDependencies = Readonly<{
  authorization: AiAuthorizationPort
  processingProfiles: PropertyProcessingProfilePort
  aggregates: AiPropertyAggregateStorePort
  calendar: AiPropertyCalendarPort
  reviewSources: Pick<AiReviewSourcePort, 'readTrendPopulation'>
  nowEpochMillis: () => number
}>

export type ReadPropertyInsightsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  actorUserId: UserId
  range: PropertyInsightsRange
}>

export type Period = Readonly<{ startLocalDate: string; endLocalDate: string }>

type WindowSummary = Readonly<{
  basis: AiPropertyInsightsBasis
  analyzed: readonly AiPropertyAnalyzedReview[]
}>

type AspectTotal = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  mentionCount: number
  impact: number
}>

const POPULATION_QUERY_LIMIT = 10_001
const MAX_EMERGING_ISSUES = 5

function reviewVersionKey(
  review: Readonly<{
    reviewId: string
    sourceRevision: number
    analysisSequence: number
  }>,
): string {
  return `${review.reviewId}:${review.sourceRevision}:${review.analysisSequence}`
}

function inPeriod(localDate: string, period: Period): boolean {
  return localDate >= period.startLocalDate && localDate <= period.endLocalDate
}

function summarizeWindow(
  period: Period,
  population: readonly AiTrendPopulationReview[],
  analyzedByVersion: ReadonlyMap<string, AiPropertyAnalyzedReview>,
  unavailableByVersion: ReadonlyMap<string, AiPropertyUnavailableReview>,
): WindowSummary {
  const reviews = population.filter((review) => inPeriod(review.localDate, period))
  const ratingCounts = [0, 0, 0, 0, 0]
  const analyzed: AiPropertyAnalyzedReview[] = []
  let starOnlyCount = 0
  let notAnalyzableCount = 0
  let awaitingAnalysisCount = 0

  for (const review of reviews) {
    ratingCounts[review.rating - 1] = (ratingCounts[review.rating - 1] ?? 0) + 1
    if (!review.hasText) {
      starOnlyCount += 1
      continue
    }

    const key = reviewVersionKey(review)
    const ready = analyzedByVersion.get(key)
    if (ready !== undefined && ready.localDate === review.localDate) {
      analyzed.push(ready)
      continue
    }
    const unavailable = unavailableByVersion.get(key)
    if (unavailable !== undefined && unavailable.localDate === review.localDate) {
      notAnalyzableCount += 1
      continue
    }
    awaitingAnalysisCount += 1
  }

  const currentAnalysisCount = analyzed.length + notAnalyzableCount
  if (
    analyzed.length + starOnlyCount + notAnalyzableCount + awaitingAnalysisCount !==
    reviews.length
  ) {
    throw new Error('Property insights basis does not account for every Review')
  }

  const stars = [1, 2, 3, 4, 5] as const
  return Object.freeze({
    basis: Object.freeze({
      reviewCount: reviews.length,
      analyzedReviewCount: analyzed.length,
      currentAnalysisCount,
      starOnlyCount,
      notAnalyzableCount,
      awaitingAnalysisCount,
      ratingDistribution: Object.freeze(
        stars.map((rating) =>
          Object.freeze({ stars: rating, count: ratingCounts[rating - 1] }),
        ),
      ),
    }),
    analyzed: Object.freeze(analyzed),
  })
}

function aggregateAspects(
  reviews: readonly AiPropertyAnalyzedReview[],
): ReadonlyMap<string, AspectTotal> {
  const totals = new Map<string, AspectTotal>()
  for (const review of reviews) {
    for (const mention of review.aspects) {
      const key = `${mention.aspect}:${mention.polarity}`
      const previous = totals.get(key)
      totals.set(
        key,
        Object.freeze({
          aspect: mention.aspect,
          polarity: mention.polarity,
          mentionCount: (previous?.mentionCount ?? 0) + 1,
          impact:
            (previous?.impact ?? 0) +
            computeAspectImpact({ ...mention, rating: review.rating }),
        }),
      )
    }
  }
  return totals
}

function compareAspects(
  current: readonly AiPropertyAnalyzedReview[],
  preceding: readonly AiPropertyAnalyzedReview[] | null,
): readonly AiPropertyInsightAspect[] {
  const currentTotals = aggregateAspects(current)
  const precedingTotals =
    preceding === null ? new Map<string, AspectTotal>() : aggregateAspects(preceding)
  const identities =
    preceding === null
      ? new Set(currentTotals.keys())
      : new Set([...currentTotals.keys(), ...precedingTotals.keys()])
  const rows = [...identities].map((identity) => {
    const currentValue = currentTotals.get(identity)
    const precedingValue = precedingTotals.get(identity)
    const source = currentValue ?? precedingValue
    if (source === undefined)
      throw new Error('Property insight aspect identity is missing')
    const mentionCount = currentValue?.mentionCount ?? 0
    const impact = currentValue?.impact ?? 0
    const precedingMentionCount = precedingValue?.mentionCount ?? 0
    const precedingImpact = precedingValue?.impact ?? 0
    return Object.freeze({
      aspect: source.aspect,
      polarity: source.polarity,
      mentionCount,
      impact,
      comparison:
        preceding === null
          ? null
          : Object.freeze({
              precedingMentionCount,
              precedingImpact,
              mentionCountDelta: mentionCount - precedingMentionCount,
              impactDelta: Number((impact - precedingImpact).toFixed(6)),
            }),
    })
  })
  rows.sort(
    (left, right) =>
      Math.abs(right.impact) - Math.abs(left.impact) ||
      right.mentionCount - left.mentionCount ||
      left.aspect.localeCompare(right.aspect) ||
      left.polarity.localeCompare(right.polarity),
  )
  return Object.freeze(rows)
}

function weeklySeries(
  period: Period,
  analyzed: readonly AiPropertyAnalyzedReview[],
  aspects: readonly AiPropertyInsightAspect[],
): readonly AiPropertyInsightWeeklySeries[] {
  const ranking = new Map<
    AspectTaxonomyV1Id,
    Readonly<{ impactMagnitude: number; mentionCount: number }>
  >()
  for (const row of aspects) {
    if (row.mentionCount === 0) continue
    const previous = ranking.get(row.aspect)
    ranking.set(
      row.aspect,
      Object.freeze({
        impactMagnitude: (previous?.impactMagnitude ?? 0) + Math.abs(row.impact),
        mentionCount: (previous?.mentionCount ?? 0) + row.mentionCount,
      }),
    )
  }
  const selected = [...ranking]
    .sort(
      ([leftAspect, left], [rightAspect, right]) =>
        right.impactMagnitude - left.impactMagnitude ||
        right.mentionCount - left.mentionCount ||
        leftAspect.localeCompare(rightAspect),
    )
    .map(([aspect]) => aspect)
  if (selected.length === 0) return Object.freeze([])

  const weekStarts: string[] = []
  const weekByDate = new Map<string, number>()
  let localDate = period.startLocalDate
  let offset = 0
  while (localDate <= period.endLocalDate) {
    const weekIndex = Math.floor(offset / 7)
    if (offset % 7 === 0) weekStarts.push(localDate)
    weekByDate.set(localDate, weekIndex)
    localDate = addDays(localDate, 1)
    offset += 1
  }

  const counts = new Map(
    selected.map((aspect) => [aspect, Array<number>(weekStarts.length).fill(0)] as const),
  )
  for (const review of analyzed) {
    const weekIndex = weekByDate.get(review.localDate)
    if (weekIndex === undefined) continue
    for (const mention of review.aspects) {
      const aspectCounts = counts.get(mention.aspect)
      if (aspectCounts !== undefined) {
        aspectCounts[weekIndex] = (aspectCounts[weekIndex] ?? 0) + 1
      }
    }
  }

  return Object.freeze(
    selected.map((aspect) =>
      Object.freeze({
        aspect,
        points: Object.freeze(
          weekStarts.map((weekStartLocalDate, index) =>
            Object.freeze({
              weekStartLocalDate,
              mentionCount: counts.get(aspect)?.[index] ?? 0,
            }),
          ),
        ),
      }),
    ),
  )
}

function emergingIssues(
  current: readonly AiPropertyAnalyzedReview[],
  preceding: readonly AiPropertyAnalyzedReview[] | null,
): readonly AiPropertyInsightIssue[] {
  const countLabels = (reviews: readonly AiPropertyAnalyzedReview[]) => {
    const counts = new Map<string, number>()
    for (const review of reviews) {
      if (review.issueLabel !== null && isAiIssueLabel(review.issueLabel)) {
        counts.set(review.issueLabel, (counts.get(review.issueLabel) ?? 0) + 1)
      }
    }
    return counts
  }
  const currentCounts = countLabels(current)
  const precedingCounts = preceding === null ? null : countLabels(preceding)
  return Object.freeze(
    [...currentCounts]
      .map(([label, count]) => {
        const precedingCount = precedingCounts?.get(label) ?? 0
        return Object.freeze({
          label,
          count,
          comparison:
            precedingCounts === null
              ? null
              : Object.freeze({
                  precedingCount,
                  delta: count - precedingCount,
                }),
        })
      })
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      )
      .slice(0, MAX_EMERGING_ISSUES),
  )
}

// Active Review evidence already enforces its retention horizon. Year one is only an
// inclusive query sentinel; the earliest returned review becomes the visible boundary.
const ALL_TIME_FLOOR_LOCAL_DATE = '0001-01-01'

export function createReadPropertyInsights(
  dependencies: ReadPropertyInsightsDependencies,
): (input: ReadPropertyInsightsInput) => Promise<AiPropertyInsightsRead> {
  return async (input) => {
    if (!isPropertyInsightsRange(input.range)) {
      throw new TypeError('Property insights range must be 30, 90, 180, or all')
    }

    // This intentionally mirrors every AI-owned aggregate read: the same gate and
    // property-local calendar must resolve before a date-bounded store query.
    // fallow-ignore-next-line code-duplication
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'disabled' }

    const endLocalDate = await dependencies.calendar.resolveLocalDate({
      reviewedAtEpochMillis: dependencies.nowEpochMillis(),
      timezone: gate.profile.timezone,
      calendarProfileVersion: 'property-calendar-v1',
    })
    if (endLocalDate === null) return { status: 'preparing' }

    const scope = {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: gate.authorization.authorizedSourceEpoch,
    }
    const populationInput = {
      ...scope,
      timezone: gate.profile.timezone,
      calendarProfileVersion: 'property-calendar-v1' as const,
      endLocalDate,
      limit: POPULATION_QUERY_LIMIT,
    }
    let startLocalDate: string
    let precedingPeriod: Period | null
    let populationReviews: readonly AiTrendPopulationReview[]
    let aggregate: Readonly<{
      analyzedReviews: readonly AiPropertyAnalyzedReview[]
      unavailableReviews: readonly AiPropertyUnavailableReview[]
    }> | null

    if (input.range === 'all') {
      const population = await dependencies.reviewSources.readTrendPopulation({
        ...populationInput,
        startLocalDate: ALL_TIME_FLOOR_LOCAL_DATE,
      })
      if (population.status !== 'complete') return { status: 'preparing' }
      const earliestEvidenceLocalDate = population.reviews.reduce<string | null>(
        (earliest, review) =>
          earliest === null || review.localDate < earliest ? review.localDate : earliest,
        null,
      )
      if (earliestEvidenceLocalDate === null) {
        return { status: 'insufficient_data', startLocalDate: null, endLocalDate }
      }
      startLocalDate = earliestEvidenceLocalDate
      precedingPeriod = null
      populationReviews = population.reviews
      aggregate = await dependencies.aggregates.readWindow({
        ...scope,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
        propertyProfileVersion: gate.profile.profileVersion,
        startLocalDate,
        endLocalDate,
      })
    } else {
      startLocalDate = addDays(endLocalDate, -(input.range - 1))
      const precedingEndLocalDate = addDays(startLocalDate, -1)
      precedingPeriod = Object.freeze({
        startLocalDate: addDays(precedingEndLocalDate, -(input.range - 1)),
        endLocalDate: precedingEndLocalDate,
      })
      const [window, population] = await Promise.all([
        dependencies.aggregates.readWindow({
          ...scope,
          reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
          propertyProfileVersion: gate.profile.profileVersion,
          startLocalDate: precedingPeriod.startLocalDate,
          endLocalDate,
        }),
        dependencies.reviewSources.readTrendPopulation({
          ...populationInput,
          startLocalDate: precedingPeriod.startLocalDate,
        }),
      ])
      if (population.status !== 'complete') return { status: 'preparing' }
      aggregate = window
      populationReviews = population.reviews
    }
    if (aggregate === null) return { status: 'preparing' }

    const analyzedByVersion = new Map(
      aggregate.analyzedReviews.map((review) => [reviewVersionKey(review), review]),
    )
    const unavailableByVersion = new Map(
      aggregate.unavailableReviews.map((review) => [reviewVersionKey(review), review]),
    )
    const currentPeriod = Object.freeze({ startLocalDate, endLocalDate })
    const current = summarizeWindow(
      currentPeriod,
      populationReviews,
      analyzedByVersion,
      unavailableByVersion,
    )
    if (current.basis.reviewCount === 0) {
      return { status: 'insufficient_data', startLocalDate, endLocalDate }
    }
    const preceding =
      precedingPeriod === null
        ? null
        : summarizeWindow(
            precedingPeriod,
            populationReviews,
            analyzedByVersion,
            unavailableByVersion,
          )
    const precedingAnalyzed = preceding?.analyzed ?? null
    const aspects = compareAspects(current.analyzed, precedingAnalyzed)

    return Object.freeze({
      status: 'ready',
      range: input.range,
      startLocalDate,
      endLocalDate,
      precedingPeriod,
      dataThroughLocalDate: endLocalDate,
      impactVersion: ASPECT_IMPACT_VERSION,
      basis: current.basis,
      aspects,
      weeklyAspectSeries: weeklySeries(currentPeriod, current.analyzed, aspects),
      emergingIssues: emergingIssues(current.analyzed, precedingAnalyzed),
    })
  }
}
