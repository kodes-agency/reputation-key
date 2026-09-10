import type {
  AiReviewSourcePort,
  AiTrendPopulationRequest,
  AiTrendPopulationResult,
  AiTrendPopulationReview,
} from '#/contexts/review/application/public-api'
import { ASPECT_IMPACT_VERSION, computeAspectImpact } from '#/shared/aspect-impact'
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { DERIVATIVE_RETENTION_MILLIS } from '../../domain/types'
import { resolveAiReadGate } from '../ai-read-gate'
import { addDays } from '../local-date'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyAggregateWindow,
  AiPropertyAggregateWindowRequest,
  AiPropertyAnalyzedReview,
  AiPropertyUnavailableReview,
} from '../ports/ai-property-aggregate-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'

const PROPERTY_INSIGHTS_PRESETS = [30, 90, 180] as const
export type PropertyInsightsPreset = (typeof PROPERTY_INSIGHTS_PRESETS)[number]
export const PROPERTY_INSIGHTS_RANGES = [...PROPERTY_INSIGHTS_PRESETS, 'all'] as const
export type PropertyInsightsRange = (typeof PROPERTY_INSIGHTS_RANGES)[number]

export function isPropertyInsightsRange(value: unknown): value is PropertyInsightsRange {
  return PROPERTY_INSIGHTS_RANGES.some((candidate) => candidate === value)
}

export type AiPropertyInsightsRatingBucket = Readonly<{
  stars: 1 | 2 | 3 | 4 | 5
  count: number
}>

export type AiPropertyInsightAspectEvidenceState =
  'available' | 'no_mentions' | 'predates_aspect_analysis' | 'not_analyzed'

export type AiPropertyInsightsBasis = Readonly<{
  reviewCount: number
  /** Ready analyses with aspect evidence that contributes to this report. */
  analyzedReviewCount: number
  /** Ready v1-era analyses that predate aspect extraction. */
  preAspectAnalysisCount: number
  /** All ready and unavailable current analyses, for explicit coverage reporting. */
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
}>

export type AiPropertyInsightComparedAspect = Readonly<
  AiPropertyInsightAspect & {
    comparison: Readonly<{
      precedingMentionCount: number
      precedingImpact: number
      mentionCountDelta: number
      impactDelta: number
    }>
  }
>

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
}>

export type AiPropertyInsightComparedIssue = Readonly<
  AiPropertyInsightIssue & {
    comparison: Readonly<{
      precedingCount: number
      delta: number
    }>
  }
>

export type Period = Readonly<{ startLocalDate: string; endLocalDate: string }>

type AiPropertyInsightsReadyBase = Readonly<{
  status: 'ready'
  startLocalDate: string
  endLocalDate: string
  dataThroughLocalDate: string
  impactVersion: typeof ASPECT_IMPACT_VERSION
  basis: AiPropertyInsightsBasis
  aspectEvidenceState: AiPropertyInsightAspectEvidenceState
  weeklyAspectSeries: readonly AiPropertyInsightWeeklySeries[]
}>

export type AiPropertyInsightsPresetReady = Readonly<
  AiPropertyInsightsReadyBase & {
    range: PropertyInsightsPreset
    precedingPeriod: Period
    aspects: readonly AiPropertyInsightComparedAspect[]
    emergingIssues: readonly AiPropertyInsightComparedIssue[]
  }
>

export type AiPropertyInsightsAllTimeReady = Readonly<
  AiPropertyInsightsReadyBase & {
    range: 'all'
    windowStartBasis: 'earliest_evidence' | 'derivative_retention_horizon'
    aspects: readonly AiPropertyInsightAspect[]
    emergingIssues: readonly AiPropertyInsightIssue[]
  }
>

export type AiPropertyInsightsRead =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{
      status: 'insufficient_data'
      startLocalDate: string | null
      endLocalDate: string
    }>
  | AiPropertyInsightsPresetReady
  | AiPropertyInsightsAllTimeReady

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
const MILLIS_PER_DAY = 24 * 60 * 60 * 1_000
const DERIVATIVE_RETENTION_DAYS = DERIVATIVE_RETENTION_MILLIS / MILLIS_PER_DAY

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
  let preAspectAnalysisCount = 0
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
      if (ready.aspects.length === 0) preAspectAnalysisCount += 1
      continue
    }
    const unavailable = unavailableByVersion.get(key)
    if (unavailable !== undefined && unavailable.localDate === review.localDate) {
      notAnalyzableCount += 1
      continue
    }
    awaitingAnalysisCount += 1
  }

  const analyzedReviewCount = analyzed.length - preAspectAnalysisCount
  const currentAnalysisCount = analyzed.length + notAnalyzableCount
  if (
    analyzedReviewCount +
      preAspectAnalysisCount +
      starOnlyCount +
      notAnalyzableCount +
      awaitingAnalysisCount !==
    reviews.length
  ) {
    throw new Error('Property insights basis does not account for every Review')
  }

  const stars = [1, 2, 3, 4, 5] as const
  return Object.freeze({
    basis: Object.freeze({
      reviewCount: reviews.length,
      analyzedReviewCount,
      preAspectAnalysisCount,
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

function resolveAspectEvidenceState(
  basis: AiPropertyInsightsBasis,
  aspects: readonly AiPropertyInsightAspect[],
): AiPropertyInsightAspectEvidenceState {
  if (basis.analyzedReviewCount === 0) {
    return basis.preAspectAnalysisCount > 0 ? 'predates_aspect_analysis' : 'not_analyzed'
  }
  return aspects.some((aspect) => aspect.mentionCount > 0) ? 'available' : 'no_mentions'
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

function allTimeAspects(
  current: readonly AiPropertyAnalyzedReview[],
): readonly AiPropertyInsightAspect[] {
  const rows = [...aggregateAspects(current).values()].map((value) =>
    Object.freeze({
      aspect: value.aspect,
      polarity: value.polarity,
      mentionCount: value.mentionCount,
      impact: value.impact,
    }),
  )
  rows.sort(
    (left, right) =>
      Math.abs(right.impact) - Math.abs(left.impact) ||
      right.mentionCount - left.mentionCount ||
      left.aspect.localeCompare(right.aspect) ||
      left.polarity.localeCompare(right.polarity),
  )
  return Object.freeze(rows)
}

function compareAspects(
  current: readonly AiPropertyAnalyzedReview[],
  preceding: readonly AiPropertyAnalyzedReview[],
): readonly AiPropertyInsightComparedAspect[] {
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
      comparison: Object.freeze({
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

function countIssueLabels(
  reviews: readonly AiPropertyAnalyzedReview[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const review of reviews) {
    if (review.issueLabel !== null && isAiIssueLabel(review.issueLabel)) {
      counts.set(review.issueLabel, (counts.get(review.issueLabel) ?? 0) + 1)
    }
  }
  return counts
}

function allTimeEmergingIssues(
  current: readonly AiPropertyAnalyzedReview[],
): readonly AiPropertyInsightIssue[] {
  return Object.freeze(
    [...countIssueLabels(current)]
      .map(([label, count]) => Object.freeze({ label, count }))
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      )
      .slice(0, MAX_EMERGING_ISSUES),
  )
}

function compareEmergingIssues(
  current: readonly AiPropertyAnalyzedReview[],
  preceding: readonly AiPropertyAnalyzedReview[],
): readonly AiPropertyInsightComparedIssue[] {
  const precedingCounts = countIssueLabels(preceding)
  return Object.freeze(
    [...countIssueLabels(current)]
      .map(([label, count]) => {
        const precedingCount = precedingCounts.get(label) ?? 0
        return Object.freeze({
          label,
          count,
          comparison: Object.freeze({
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

type CompleteTrendPopulation = Extract<AiTrendPopulationResult, { status: 'complete' }>
type InsightsAggregateScope = Omit<
  AiPropertyAggregateWindowRequest,
  'startLocalDate' | 'endLocalDate'
>
type InsightsPopulationScope = Omit<
  AiTrendPopulationRequest,
  'startLocalDate' | 'detectEvidenceBeforeStart'
>
type InsightsEvidenceRequests = Readonly<{
  aggregateScope: InsightsAggregateScope
  populationScope: InsightsPopulationScope
  endLocalDate: string
}>
type PreparedCurrentWindow = Readonly<{
  current: WindowSummary
  analyzedByVersion: ReadonlyMap<string, AiPropertyAnalyzedReview>
  unavailableByVersion: ReadonlyMap<string, AiPropertyUnavailableReview>
}>

function prepareCurrentWindow(
  period: Period,
  population: CompleteTrendPopulation,
  aggregate: AiPropertyAggregateWindow,
): PreparedCurrentWindow {
  const analyzedByVersion = new Map(
    aggregate.analyzedReviews.map((review) => [reviewVersionKey(review), review]),
  )
  const unavailableByVersion = new Map(
    aggregate.unavailableReviews.map((review) => [reviewVersionKey(review), review]),
  )
  return Object.freeze({
    current: summarizeWindow(
      period,
      population.reviews,
      analyzedByVersion,
      unavailableByVersion,
    ),
    analyzedByVersion,
    unavailableByVersion,
  })
}

async function readAllTimeInsights(
  dependencies: ReadPropertyInsightsDependencies,
  requests: InsightsEvidenceRequests,
): Promise<AiPropertyInsightsRead> {
  const { aggregateScope, populationScope, endLocalDate } = requests
  const retentionStartLocalDate = addDays(endLocalDate, -DERIVATIVE_RETENTION_DAYS)
  const population = await dependencies.reviewSources.readTrendPopulation({
    ...populationScope,
    startLocalDate: retentionStartLocalDate,
    detectEvidenceBeforeStart: true,
  })
  if (population.status !== 'complete') return { status: 'preparing' }

  const earliestEvidenceLocalDate = population.reviews.reduce<string | null>(
    (earliest, review) =>
      earliest === null || review.localDate < earliest ? review.localDate : earliest,
    null,
  )
  if (earliestEvidenceLocalDate === null) {
    return {
      status: 'insufficient_data',
      startLocalDate: population.hasEvidenceBeforeStart ? retentionStartLocalDate : null,
      endLocalDate,
    }
  }

  const retentionLimited = population.hasEvidenceBeforeStart
  const startLocalDate = retentionLimited
    ? retentionStartLocalDate
    : earliestEvidenceLocalDate
  const aggregate = await dependencies.aggregates.readWindow({
    ...aggregateScope,
    startLocalDate,
    endLocalDate,
  })
  if (aggregate === null) return { status: 'preparing' }

  const currentPeriod = Object.freeze({ startLocalDate, endLocalDate })
  const { current } = prepareCurrentWindow(currentPeriod, population, aggregate)
  if (current.basis.reviewCount === 0) {
    return { status: 'insufficient_data', startLocalDate, endLocalDate }
  }
  const aspects = allTimeAspects(current.analyzed)

  return Object.freeze({
    status: 'ready',
    range: 'all',
    startLocalDate,
    endLocalDate,
    windowStartBasis: retentionLimited
      ? 'derivative_retention_horizon'
      : 'earliest_evidence',
    dataThroughLocalDate: endLocalDate,
    impactVersion: ASPECT_IMPACT_VERSION,
    basis: current.basis,
    aspectEvidenceState: resolveAspectEvidenceState(current.basis, aspects),
    aspects,
    weeklyAspectSeries: weeklySeries(currentPeriod, current.analyzed, aspects),
    emergingIssues: allTimeEmergingIssues(current.analyzed),
  })
}

async function readPresetInsights(
  dependencies: ReadPropertyInsightsDependencies,
  requests: InsightsEvidenceRequests,
  range: PropertyInsightsPreset,
): Promise<AiPropertyInsightsRead> {
  const { aggregateScope, populationScope, endLocalDate } = requests
  const startLocalDate = addDays(endLocalDate, -(range - 1))
  const precedingEndLocalDate = addDays(startLocalDate, -1)
  const precedingPeriod = Object.freeze({
    startLocalDate: addDays(precedingEndLocalDate, -(range - 1)),
    endLocalDate: precedingEndLocalDate,
  })
  const [aggregate, population] = await Promise.all([
    dependencies.aggregates.readWindow({
      ...aggregateScope,
      startLocalDate: precedingPeriod.startLocalDate,
      endLocalDate,
    }),
    dependencies.reviewSources.readTrendPopulation({
      ...populationScope,
      startLocalDate: precedingPeriod.startLocalDate,
      detectEvidenceBeforeStart: false,
    }),
  ])
  if (aggregate === null || population.status !== 'complete') {
    return { status: 'preparing' }
  }

  const currentPeriod = Object.freeze({ startLocalDate, endLocalDate })
  const { current, analyzedByVersion, unavailableByVersion } = prepareCurrentWindow(
    currentPeriod,
    population,
    aggregate,
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
    range,
    startLocalDate,
    endLocalDate,
    precedingPeriod,
    dataThroughLocalDate: endLocalDate,
    impactVersion: ASPECT_IMPACT_VERSION,
    basis: current.basis,
    aspects,
    aspectEvidenceState: resolveAspectEvidenceState(current.basis, aspects),
    weeklyAspectSeries: weeklySeries(currentPeriod, current.analyzed, aspects),
    emergingIssues: compareEmergingIssues(current.analyzed, preceding.analyzed),
  })
}

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
    const requests = {
      endLocalDate,
      aggregateScope: {
        ...scope,
        reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
        propertyProfileVersion: gate.profile.profileVersion,
      },
      populationScope: {
        ...scope,
        timezone: gate.profile.timezone,
        calendarProfileVersion: 'property-calendar-v1' as const,
        endLocalDate,
        limit: POPULATION_QUERY_LIMIT,
      },
    }

    return input.range === 'all'
      ? readAllTimeInsights(dependencies, requests)
      : readPresetInsights(dependencies, requests, input.range)
  }
}
