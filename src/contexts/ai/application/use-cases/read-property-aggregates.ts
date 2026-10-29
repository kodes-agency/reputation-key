import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyAggregateWindow,
  AiPropertyAnalyzedReview,
  AiPropertyDailyAggregate,
  AiPropertyDailyAspectCount,
} from '../ports/ai-property-aggregate-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { addDays } from '../local-date'
import { resolveAiReadGate } from '../ai-read-gate'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../ai-property-read-access'
import { ASPECT_IMPACT_VERSION, computeAspectImpact } from '#/shared/aspect-impact'
import {
  NO_RATING_COUNTS,
  aspectKey,
  collectAspectReviewEvidence,
  countIssueLabels,
  ratingCountsOf,
  recurringIssues,
  starsOfMentioned,
  type AspectStars,
  type RatingCounts,
} from '../aspect-review-evidence'

export type AiAspectAggregate = Readonly<{
  aspect: AiPropertyDailyAspectCount['aspect']
  polarity: AiPropertyDailyAspectCount['polarity']
  mentionCount: number
  /** Reviews, not mentions: a review that names the topic twice counts once. */
  reviewCount: number
  /** The stars those reviews gave: how many gave 1, 2, 3, 4 and 5. */
  ratingCounts: RatingCounts
  /**
   * Those stars against the other reviews analysed for topics in the window.
   * This read is built from analyses, which a review with only stars never has,
   * so "the rest" here is reviews with text: a page that has the star-only
   * reviews (Guest voice) puts them in.
   */
  stars: AspectStars
  impact: number
}>

export type AiEmergingIssue = Readonly<{
  label: string
  count: number
}>

export type AiSentimentDay = Readonly<{
  localDate: string
  positive: number
  neutral: number
  negative: number
  mixed: number
}>

/**
 * The dashboard's settled 30-day view: aspect mentions and rating-weighted
 * impact, sentiment by day, and bounded emerging issue labels.
 */
export type AiPropertyAggregateWindowRead =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{
      status: 'ready'
      provisional: boolean
      coverage: AiPropertyAggregateWindow['coverage']
      startLocalDate: string
      endLocalDate: string
      reviewCount: number
      /** Ready analyses with aspect evidence. */
      analyzedReviewCount: number
      /** Ready v1-era analyses that predate aspect extraction. */
      preAspectAnalysisCount: number
      impactVersion: typeof ASPECT_IMPACT_VERSION
      /** Descending by review count, then mention count, then stable aspect/polarity identity. */
      aspects: readonly AiAspectAggregate[]
      /** Labels two or more of the window's reviews carry. */
      emergingIssues: readonly AiEmergingIssue[]
      /** Only days that actually have a row; absent days are genuinely absent. */
      sentimentByDay: readonly AiSentimentDay[]
      sentimentTotals: Readonly<{
        positive: number
        neutral: number
        negative: number
        mixed: number
      }>
    }>

export type ReadPropertyAggregatesDependencies = Readonly<{
  propertyAccess: AiPropertyAccess
  authorization: AiAuthorizationPort
  processingProfiles: PropertyProcessingProfilePort
  aggregates: AiPropertyAggregateStorePort
  calendar: AiPropertyCalendarPort
  nowEpochMillis: () => number
}>

export type ReadPropertyAggregatesInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  /** The reader, authorized for the Property before anything is read. */
  actor: AuthContext
  /** Window length in property-local days, inclusive of today. */
  days: number
}>

export function createReadPropertyAggregates(
  dependencies: ReadPropertyAggregatesDependencies,
): (input: ReadPropertyAggregatesInput) => Promise<AiPropertyAggregateWindowRead> {
  return async (input) => {
    await requireAiPropertyReadAccess(
      dependencies.propertyAccess,
      input.actor,
      'dashboard.read',
      input,
    )
    // Aspect mentions and sentiment are review-analysis derivatives, so this
    // read is gated on `review_analysis` rather than `property_trends`.
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'disabled' }

    // The table is keyed by the property's LOCAL date, so the window has to be
    // resolved through the calendar. Using a UTC day here would silently shift
    // the window by one day for most of the world.
    const endLocalDate = await dependencies.calendar.resolveLocalDate({
      reviewedAtEpochMillis: dependencies.nowEpochMillis(),
      timezone: gate.profile.timezone,
      calendarProfileVersion: 'property-calendar-v1',
    })
    if (endLocalDate === null) return { status: 'preparing' }
    const startLocalDate = addDays(endLocalDate, -(Math.max(1, input.days) - 1))

    // Every column of the primary key is pinned. The grain is one row per
    // property per local date PER EPOCH TRIPLE, so a read that filtered on
    // dates alone would sum the same day across successive epochs and report
    // inflated counts.
    const window = await dependencies.aggregates.readWindow({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: gate.authorization.authorizedSourceEpoch,
      reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
      propertyProfileVersion: gate.profile.profileVersion,
      startLocalDate,
      endLocalDate,
    })
    // A missing window means that no aggregate evidence has been applied yet.
    // Coverage gaps now return the exact partial window instead of hiding it.
    if (window === null || window.coverage.settledAnalysisCount === 0) {
      return { status: 'preparing' }
    }

    return {
      status: 'ready',
      provisional: window.coverage.awaitingAnalysisCount > 0,
      coverage: window.coverage,
      startLocalDate,
      endLocalDate,
      ...summarize(window.days, window.analyzedReviews),
    }
  }
}

function summarize(
  days: readonly AiPropertyDailyAggregate[],
  analyzedReviews: readonly AiPropertyAnalyzedReview[],
): Omit<
  Extract<AiPropertyAggregateWindowRead, { status: 'ready' }>,
  'status' | 'provisional' | 'coverage' | 'startLocalDate' | 'endLocalDate'
> {
  const mentionTotals = new Map<
    string,
    {
      aspect: AiAspectAggregate['aspect']
      polarity: AiAspectAggregate['polarity']
      mentionCount: number
    }
  >()
  const sentimentTotals = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  let reviewCount = 0
  const sentimentByDay: AiSentimentDay[] = []

  for (const day of days) {
    reviewCount += day.reviewCount
    for (const mention of day.aspectCounts) {
      const key = aspectKey(mention.aspect, mention.polarity)
      const total = mentionTotals.get(key) ?? {
        aspect: mention.aspect,
        polarity: mention.polarity,
        mentionCount: 0,
      }
      total.mentionCount += mention.count
      mentionTotals.set(key, total)
    }
    sentimentTotals.positive += day.sentimentCounts.positive
    sentimentTotals.neutral += day.sentimentCounts.neutral
    sentimentTotals.negative += day.sentimentCounts.negative
    sentimentTotals.mixed += day.sentimentCounts.mixed
    sentimentByDay.push({ localDate: day.localDate, ...day.sentimentCounts })
  }

  // A review with no topic at all is a v1-era analysis: it says nothing about
  // any topic, so it is neither a review that names one nor one that does not.
  const withTopics = analyzedReviews.filter((review) => review.aspects.length > 0)
  const analyzedReviewCount = withTopics.length
  const preAspectAnalysisCount = analyzedReviews.length - analyzedReviewCount
  const evidence = collectAspectReviewEvidence(withTopics)
  const window = {
    ratingCounts: ratingCountsOf(withTopics),
    reviewCount: analyzedReviewCount,
  }
  const impacts = new Map<string, number>()
  for (const review of withTopics) {
    for (const mention of review.aspects) {
      const key = aspectKey(mention.aspect, mention.polarity)
      impacts.set(
        key,
        (impacts.get(key) ?? 0) +
          computeAspectImpact({ ...mention, rating: review.rating }),
      )
    }
  }

  const aspects = [...mentionTotals]
    .map(([key, total]): AiAspectAggregate => {
      const reviews = evidence.byAspect.get(key)
      const ratingCounts = reviews?.ratingCounts ?? NO_RATING_COUNTS
      return {
        ...total,
        reviewCount: reviews?.reviewCount ?? 0,
        ratingCounts,
        stars: starsOfMentioned(ratingCounts, window),
        impact: impacts.get(key) ?? 0,
      }
    })
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount ||
        b.mentionCount - a.mentionCount ||
        a.aspect.localeCompare(b.aspect) ||
        a.polarity.localeCompare(b.polarity),
    )

  return {
    reviewCount,
    analyzedReviewCount,
    preAspectAnalysisCount,
    impactVersion: ASPECT_IMPACT_VERSION,
    aspects,
    emergingIssues: recurringIssues(countIssueLabels(analyzedReviews)),
    sentimentByDay,
    sentimentTotals,
  }
}
