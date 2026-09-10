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

export const PROPERTY_INSIGHTS_RANGE_DAYS = [30, 90, 180] as const
export type PropertyInsightsRangeDays = (typeof PROPERTY_INSIGHTS_RANGE_DAYS)[number]

export function isPropertyInsightsRangeDays(
  value: unknown,
): value is PropertyInsightsRangeDays {
  return (
    typeof value === 'number' &&
    PROPERTY_INSIGHTS_RANGE_DAYS.some((candidate) => candidate === value)
  )
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
  precedingMentionCount: number
  precedingImpact: number
  mentionCountDelta: number
  impactDelta: number
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
  precedingCount: number
  delta: number
}>

export type AiPropertyInsightsRead =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{
      status: 'insufficient_data'
      startLocalDate: string
      endLocalDate: string
    }>
  | Readonly<{
      status: 'ready'
      rangeDays: PropertyInsightsRangeDays
      startLocalDate: string
      endLocalDate: string
      precedingStartLocalDate: string
      precedingEndLocalDate: string
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
  rangeDays: PropertyInsightsRangeDays
}>

type Period = Readonly<{ startLocalDate: string; endLocalDate: string }>

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
  preceding: readonly AiPropertyAnalyzedReview[],
): readonly AiPropertyInsightAspect[] {
  const currentTotals = aggregateAspects(current)
  const precedingTotals = aggregateAspects(preceding)
  const identities = new Set([...currentTotals.keys(), ...precedingTotals.keys()])
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
      precedingMentionCount,
      precedingImpact,
      mentionCountDelta: mentionCount - precedingMentionCount,
      impactDelta: Number((impact - precedingImpact).toFixed(6)),
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
  startLocalDate: string,
  rangeDays: PropertyInsightsRangeDays,
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
  let localDate = startLocalDate
  for (let offset = 0; offset < rangeDays; offset += 1) {
    const weekIndex = Math.floor(offset / 7)
    if (offset % 7 === 0) weekStarts.push(localDate)
    weekByDate.set(localDate, weekIndex)
    localDate = addDays(localDate, 1)
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
  preceding: readonly AiPropertyAnalyzedReview[],
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
  const precedingCounts = countLabels(preceding)
  return Object.freeze(
    [...currentCounts]
      .map(([label, count]) => {
        const precedingCount = precedingCounts.get(label) ?? 0
        return Object.freeze({
          label,
          count,
          precedingCount,
          delta: count - precedingCount,
        })
      })
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      )
      .slice(0, MAX_EMERGING_ISSUES),
  )
}

export function createReadPropertyInsights(
  dependencies: ReadPropertyInsightsDependencies,
): (input: ReadPropertyInsightsInput) => Promise<AiPropertyInsightsRead> {
  return async (input) => {
    if (!isPropertyInsightsRangeDays(input.rangeDays)) {
      throw new TypeError('Property insights range must be 30, 90, or 180 days')
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

    const startLocalDate = addDays(endLocalDate, -(input.rangeDays - 1))
    const precedingEndLocalDate = addDays(startLocalDate, -1)
    const precedingStartLocalDate = addDays(precedingEndLocalDate, -(input.rangeDays - 1))
    const scope = {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: gate.authorization.authorizedSourceEpoch,
    }
    const [aggregate, population] = await Promise.all([
      dependencies.aggregates.readWindow({
        ...scope,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
        propertyProfileVersion: gate.profile.profileVersion,
        startLocalDate: precedingStartLocalDate,
        endLocalDate,
      }),
      dependencies.reviewSources.readTrendPopulation({
        ...scope,
        timezone: gate.profile.timezone,
        calendarProfileVersion: 'property-calendar-v1',
        startLocalDate: precedingStartLocalDate,
        endLocalDate,
        limit: POPULATION_QUERY_LIMIT,
      }),
    ])
    if (aggregate === null || population.status !== 'complete') {
      return { status: 'preparing' }
    }

    const analyzedByVersion = new Map(
      aggregate.analyzedReviews.map((review) => [reviewVersionKey(review), review]),
    )
    const unavailableByVersion = new Map(
      aggregate.unavailableReviews.map((review) => [reviewVersionKey(review), review]),
    )
    const currentPeriod = Object.freeze({ startLocalDate, endLocalDate })
    const precedingPeriod = Object.freeze({
      startLocalDate: precedingStartLocalDate,
      endLocalDate: precedingEndLocalDate,
    })
    const current = summarizeWindow(
      currentPeriod,
      population.reviews,
      analyzedByVersion,
      unavailableByVersion,
    )
    if (current.basis.reviewCount === 0) {
      return { status: 'insufficient_data', startLocalDate, endLocalDate }
    }
    const preceding = summarizeWindow(
      precedingPeriod,
      population.reviews,
      analyzedByVersion,
      unavailableByVersion,
    )
    const aspects = compareAspects(current.analyzed, preceding.analyzed)

    return Object.freeze({
      status: 'ready',
      rangeDays: input.rangeDays,
      startLocalDate,
      endLocalDate,
      precedingStartLocalDate,
      precedingEndLocalDate,
      dataThroughLocalDate: endLocalDate,
      impactVersion: ASPECT_IMPACT_VERSION,
      basis: current.basis,
      aspects,
      weeklyAspectSeries: weeklySeries(
        startLocalDate,
        input.rangeDays,
        current.analyzed,
        aspects,
      ),
      emergingIssues: emergingIssues(current.analyzed, preceding.analyzed),
    })
  }
}
