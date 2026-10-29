import type {
  AiReviewSourcePort,
  AiTrendPopulationRequest,
  AiTrendPopulationResult,
  AiTrendPopulationReview,
} from '#/contexts/review/application/public-api'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { chooseEvidenceWindow } from '../../domain/guest-voice-statistics'
import { DERIVATIVE_RETENTION_MILLIS } from '../../domain/types'
import {
  NO_RATING_COUNTS,
  aspectKey,
  changeOfMentions,
  collectAspectReviewEvidence,
  countIssueLabels,
  recurringIssues,
  starsOfMentioned,
  type AspectChange,
  type AspectReviewTotals,
  type AspectStars,
  type RatingCounts,
  type WindowRatings,
} from '../aspect-review-evidence'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../ai-property-read-access'
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

const PROPERTY_INSIGHTS_PRESETS = [30, 90, 180, 365] as const
export type PropertyInsightsPreset = (typeof PROPERTY_INSIGHTS_PRESETS)[number]
/**
 * `auto` is the default the Guest voice page asks for: the shortest of 30 days,
 * 90 days, 6 months and 12 months that holds enough reviews with text
 * (`chooseEvidenceWindow`). The answer names the window it chose (`range`).
 */
export const PROPERTY_INSIGHTS_RANGES = [
  'auto',
  ...PROPERTY_INSIGHTS_PRESETS,
  'all',
] as const
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

/**
 * One topic and one polarity, counted in reviews. A mention is one topic named
 * once in one analysis; a review that names it twice is still one review, and a
 * review is what the Inbox lists when a number here is followed.
 */
export type AiPropertyInsightAspect = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  /** Mentions: a review that names the topic twice counts twice. */
  mentionCount: number
  /** Reviews that name the topic with this polarity: each counts once. */
  reviewCount: number
  /**
   * Reviews that name the topic in any way (praise, complaint or neutral), each
   * once: the same on every row of one topic, and not the sum of its rows when a
   * review both praises and criticises it.
   */
  topicReviewCount: number
  /** The stars those reviews gave: how many gave 1, 2, 3, 4 and 5. */
  ratingCounts: RatingCounts
  /** Those stars against every other review in the window (see `AspectStars`). */
  stars: AspectStars
  /**
   * Whether the share of reviews that name it moved against the period before.
   * `unknown` where there is no period to compare (All Time, a window still
   * being analysed) or too few reviews to say.
   */
  change: AspectChange
}>

export type AiPropertyInsightComparedAspect = Readonly<
  AiPropertyInsightAspect & {
    comparison: Readonly<{
      precedingMentionCount: number
      /** The reviews that named it in the period before, what `change` is measured against. */
      precedingReviewCount: number
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

/** A recurring issue: a label two or more reviews in the window carry. */
export type AiPropertyInsightIssue = Readonly<{
  label: string
  count: number
}>

export type Period = Readonly<{ startLocalDate: string; endLocalDate: string }>

/**
 * How the window was set and what it holds, so the page can say it: "Last 90
 * days, chosen because it holds 128 reviews with text".
 */
export type AiPropertyInsightsWindow =
  | Readonly<{
      /** The reader picked the window. */
      selection: 'chosen'
      /** Reviews with text in the window, analysed yet or not. */
      textReviewCount: number
    }>
  | Readonly<{
      /** The shortest window that holds enough reviews with text (`range` names it). */
      selection: 'automatic'
      textReviewCount: number
      /** False when even the last 12 months hold too few reviews with text to spot patterns. */
      enoughForPatterns: boolean
    }>

type AiPropertyInsightsReadyBase<Provisional extends boolean> = Readonly<{
  status: 'ready'
  provisional: Provisional
  coverage: AiPropertyAggregateWindow['coverage']
  startLocalDate: string
  endLocalDate: string
  dataThroughLocalDate: string
  window: AiPropertyInsightsWindow
  basis: AiPropertyInsightsBasis
  aspectEvidenceState: AiPropertyInsightAspectEvidenceState
  weeklyAspectSeries: readonly AiPropertyInsightWeeklySeries[]
}>

type AiPropertyInsightsComparedPresetReady = Readonly<
  AiPropertyInsightsReadyBase<false> & {
    range: PropertyInsightsPreset
    precedingPeriod: Period
    aspects: readonly AiPropertyInsightComparedAspect[]
    /** Labels two or more reviews in the window carry (`recurringIssues`). */
    emergingIssues: readonly AiPropertyInsightIssue[]
  }
>

type AiPropertyInsightsProvisionalPresetReady = Readonly<
  AiPropertyInsightsReadyBase<true> & {
    range: PropertyInsightsPreset
    aspects: readonly AiPropertyInsightAspect[]
    emergingIssues: readonly AiPropertyInsightIssue[]
  }
>

export type AiPropertyInsightsPresetReady =
  AiPropertyInsightsComparedPresetReady | AiPropertyInsightsProvisionalPresetReady

export type AiPropertyInsightsAllTimeReady = Readonly<
  AiPropertyInsightsReadyBase<boolean> & {
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
  propertyAccess: AiPropertyAccess
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
  /** The reader, authorized for the Property before anything is read. */
  actor: AuthContext
  range: PropertyInsightsRange
}>

type WindowSummary = Readonly<{
  basis: AiPropertyInsightsBasis
  analyzed: readonly AiPropertyAnalyzedReview[]
}>

const POPULATION_QUERY_LIMIT = 10_001
const MILLIS_PER_DAY = 24 * 60 * 60 * 1_000
const DERIVATIVE_RETENTION_DAYS = DERIVATIVE_RETENTION_MILLIS / MILLIS_PER_DAY
const MONTH_DAYS = 30
const QUARTER_DAYS = 90
const HALF_YEAR_DAYS = 180
const YEAR_DAYS = 365

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

/**
 * What a window's topic rows are worked out from: the reviews that name each
 * topic, the stars of every review in the window, and how many reviews were
 * analysed for topics (what a share of reviews is a share of).
 */
type WindowEvidence = Readonly<{
  totals: AspectReviewTotals
  /**
   * Every review in the window by the stars it gave, the ones with only stars,
   * the ones still waiting and the ones in a language the analysis does not read
   * included: "the rest" a topic's stars are set against is all of them.
   */
  window: WindowRatings
  textReviews: number
}>

function windowEvidence(summary: WindowSummary): WindowEvidence {
  const distribution = summary.basis.ratingDistribution
  const stars = [1, 2, 3, 4, 5] as const
  return Object.freeze({
    totals: collectAspectReviewEvidence(summary.analyzed),
    window: Object.freeze({
      ratingCounts: stars.map(
        (star) => distribution.find((bucket) => bucket.stars === star)?.count ?? 0,
      ) as unknown as RatingCounts,
      reviewCount: summary.basis.reviewCount,
    }),
    textReviews: summary.basis.analyzedReviewCount,
  })
}

/** A topic and polarity row; `preceding` is the period before, when there is one to compare. */
function aspectRow(
  identity: Readonly<{ aspect: AspectTaxonomyV1Id; polarity: AspectPolarityV1 }>,
  current: WindowEvidence,
  preceding: WindowEvidence | null,
): AiPropertyInsightAspect {
  const key = aspectKey(identity.aspect, identity.polarity)
  const now = current.totals.byAspect.get(key)
  const reviewCount = now?.reviewCount ?? 0
  const ratingCounts = now?.ratingCounts ?? NO_RATING_COUNTS
  return Object.freeze({
    aspect: identity.aspect,
    polarity: identity.polarity,
    mentionCount: now?.mentionCount ?? 0,
    reviewCount,
    topicReviewCount: current.totals.reviewsByTopic.get(identity.aspect) ?? 0,
    ratingCounts,
    stars: starsOfMentioned(ratingCounts, current.window),
    change:
      preceding === null
        ? 'unknown'
        : changeOfMentions(
            { reviewCount, textReviews: current.textReviews },
            {
              reviewCount: preceding.totals.byAspect.get(key)?.reviewCount ?? 0,
              textReviews: preceding.textReviews,
            },
          ),
  })
}

/** Most-named first: the page orders its own rows, this order only has to be stable. */
function byPrevalence(
  left: AiPropertyInsightAspect,
  right: AiPropertyInsightAspect,
): number {
  return (
    right.reviewCount - left.reviewCount ||
    right.mentionCount - left.mentionCount ||
    left.aspect.localeCompare(right.aspect) ||
    left.polarity.localeCompare(right.polarity)
  )
}

function allTimeAspects(current: WindowSummary): readonly AiPropertyInsightAspect[] {
  const evidence = windowEvidence(current)
  const rows = [...evidence.totals.byAspect.values()].map((total) =>
    aspectRow(total, evidence, null),
  )
  rows.sort(byPrevalence)
  return Object.freeze(rows)
}

function compareAspects(
  current: WindowSummary,
  preceding: WindowSummary,
): readonly AiPropertyInsightComparedAspect[] {
  const now = windowEvidence(current)
  const before = windowEvidence(preceding)
  const identities = new Map([...before.totals.byAspect, ...now.totals.byAspect])
  const rows = [...identities].map(([key, identity]) => {
    const earlier = before.totals.byAspect.get(key)
    return Object.freeze({
      ...aspectRow(identity, now, before),
      comparison: Object.freeze({
        precedingMentionCount: earlier?.mentionCount ?? 0,
        precedingReviewCount: earlier?.reviewCount ?? 0,
      }),
    })
  })
  rows.sort(byPrevalence)
  return Object.freeze(rows)
}

function weeklySeries(
  period: Period,
  analyzed: readonly AiPropertyAnalyzedReview[],
  aspects: readonly AiPropertyInsightAspect[],
): readonly AiPropertyInsightWeeklySeries[] {
  const mentionsByAspect = new Map<AspectTaxonomyV1Id, number>()
  for (const row of aspects) {
    if (row.mentionCount === 0) continue
    mentionsByAspect.set(
      row.aspect,
      (mentionsByAspect.get(row.aspect) ?? 0) + row.mentionCount,
    )
  }
  const selected = [...mentionsByAspect]
    .sort(
      ([leftAspect, leftMentions], [rightAspect, rightMentions]) =>
        rightMentions - leftMentions || leftAspect.localeCompare(rightAspect),
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

/** The window's recurring issues: labels two or more of its reviews carry. */
function windowIssues(
  analyzed: readonly AiPropertyAnalyzedReview[],
): readonly AiPropertyInsightIssue[] {
  return recurringIssues(countIssueLabels(analyzed))
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

/** How the window was set: by the reader, or by `chooseEvidenceWindow`. */
type WindowSelection =
  | Readonly<{ selection: 'chosen' }>
  | Readonly<{ selection: 'automatic'; enoughForPatterns: boolean }>

function describeWindow(
  selection: WindowSelection,
  basis: AiPropertyInsightsBasis,
): AiPropertyInsightsWindow {
  const textReviewCount = basis.reviewCount - basis.starOnlyCount
  return selection.selection === 'chosen'
    ? { selection: 'chosen', textReviewCount }
    : {
        selection: 'automatic',
        textReviewCount,
        enoughForPatterns: selection.enoughForPatterns,
      }
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
  if (aggregate === null || aggregate.coverage.settledAnalysisCount === 0) {
    return { status: 'preparing' }
  }

  const currentPeriod = Object.freeze({ startLocalDate, endLocalDate })
  const { current } = prepareCurrentWindow(currentPeriod, population, aggregate)
  if (current.basis.reviewCount === 0) {
    return { status: 'insufficient_data', startLocalDate, endLocalDate }
  }
  const aspects = allTimeAspects(current)
  const provisional =
    aggregate.coverage.awaitingAnalysisCount > 0 ||
    current.basis.awaitingAnalysisCount > 0

  return Object.freeze({
    status: 'ready',
    provisional,
    coverage: aggregate.coverage,
    range: 'all',
    startLocalDate,
    endLocalDate,
    windowStartBasis: retentionLimited
      ? 'derivative_retention_horizon'
      : 'earliest_evidence',
    dataThroughLocalDate: endLocalDate,
    window: describeWindow({ selection: 'chosen' }, current.basis),
    basis: current.basis,
    aspectEvidenceState: resolveAspectEvidenceState(current.basis, aspects),
    aspects,
    weeklyAspectSeries: weeklySeries(currentPeriod, current.analyzed, aspects),
    emergingIssues: windowIssues(current.analyzed),
  })
}

async function readPresetInsights(
  dependencies: ReadPropertyInsightsDependencies,
  requests: InsightsEvidenceRequests,
  range: PropertyInsightsPreset,
  selection: WindowSelection,
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
  if (population.status !== 'complete') return { status: 'preparing' }
  if (aggregate === null || aggregate.coverage.settledAnalysisCount === 0) {
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
  const provisional =
    aggregate.coverage.awaitingAnalysisCount > 0 ||
    current.basis.awaitingAnalysisCount > 0 ||
    preceding.basis.awaitingAnalysisCount > 0
  const readyBase = Object.freeze({
    status: 'ready' as const,
    range,
    startLocalDate,
    endLocalDate,
    dataThroughLocalDate: endLocalDate,
    window: describeWindow(selection, current.basis),
    coverage: aggregate.coverage,
    basis: current.basis,
  })

  // A window still being analysed has no comparison: the period before it may
  // be missing reviews too, and a change measured against half of it would be
  // a change in the analysis, not in the guests.
  if (provisional) {
    const aspects = allTimeAspects(current)
    return Object.freeze({
      ...readyBase,
      provisional: true,
      aspects,
      aspectEvidenceState: resolveAspectEvidenceState(current.basis, aspects),
      weeklyAspectSeries: weeklySeries(currentPeriod, current.analyzed, aspects),
      emergingIssues: windowIssues(current.analyzed),
    })
  }

  const aspects = compareAspects(current, preceding)
  return Object.freeze({
    ...readyBase,
    provisional: false,
    precedingPeriod,
    aspects,
    aspectEvidenceState: resolveAspectEvidenceState(current.basis, aspects),
    weeklyAspectSeries: weeklySeries(currentPeriod, current.analyzed, aspects),
    emergingIssues: windowIssues(current.analyzed),
  })
}

const PRESET_OF_WINDOW = {
  '30d': MONTH_DAYS,
  '90d': QUARTER_DAYS,
  '180d': HALF_YEAR_DAYS,
  '365d': YEAR_DAYS,
} as const

/**
 * The window `auto` asks for: the shortest of 30 days, 90 days, 6 months and 12
 * months that holds enough reviews with text (`chooseEvidenceWindow`). It counts
 * from the last 12 months of the Review population, which is read once more for
 * the window it picks; the count is cheap beside the analyses the window reads.
 */
async function chooseAutomaticRange(
  dependencies: ReadPropertyInsightsDependencies,
  requests: InsightsEvidenceRequests,
): Promise<Readonly<{ range: PropertyInsightsPreset; enough: boolean }> | null> {
  const { populationScope, endLocalDate } = requests
  const population = await dependencies.reviewSources.readTrendPopulation({
    ...populationScope,
    startLocalDate: addDays(endLocalDate, -(YEAR_DAYS - 1)),
    detectEvidenceBeforeStart: false,
  })
  if (population.status !== 'complete') return null

  const textReviewsSince = (days: number) => {
    const since = addDays(endLocalDate, -(days - 1))
    return population.reviews.filter(
      (review) => review.hasText && review.localDate >= since,
    ).length
  }
  const choice = chooseEvidenceWindow({
    '30d': textReviewsSince(MONTH_DAYS),
    '90d': textReviewsSince(QUARTER_DAYS),
    '180d': textReviewsSince(HALF_YEAR_DAYS),
    '365d': textReviewsSince(YEAR_DAYS),
  })
  return { range: PRESET_OF_WINDOW[choice.window], enough: choice.enough }
}

export function createReadPropertyInsights(
  dependencies: ReadPropertyInsightsDependencies,
): (input: ReadPropertyInsightsInput) => Promise<AiPropertyInsightsRead> {
  return async (input) => {
    await requireAiPropertyReadAccess(
      dependencies.propertyAccess,
      input.actor,
      'dashboard.read',
      input,
    )
    if (!isPropertyInsightsRange(input.range)) {
      throw new TypeError(
        'Property insights range must be auto, 30, 90, 180, 365, or all',
      )
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

    if (input.range === 'all') return readAllTimeInsights(dependencies, requests)
    if (input.range !== 'auto') {
      return readPresetInsights(dependencies, requests, input.range, {
        selection: 'chosen',
      })
    }
    const chosen = await chooseAutomaticRange(dependencies, requests)
    if (chosen === null) return { status: 'preparing' }
    return readPresetInsights(dependencies, requests, chosen.range, {
      selection: 'automatic',
      enoughForPatterns: chosen.enough,
    })
  }
}
