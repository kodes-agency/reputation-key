import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyAnalyzedReview,
  AiPropertyDailyAggregate,
  AiPropertyDailyAspectCount,
} from '../ports/ai-property-aggregate-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { addDays } from '../local-date'
import { resolveAiReadGate } from '../ai-read-gate'
import { ASPECT_IMPACT_VERSION, computeAspectImpact } from '#/shared/aspect-impact'
import { isAiIssueLabel } from '#/shared/ai-issue-label'

export type AiAspectAggregate = Readonly<{
  aspect: AiPropertyDailyAspectCount['aspect']
  polarity: AiPropertyDailyAspectCount['polarity']
  mentionCount: number
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
      startLocalDate: string
      endLocalDate: string
      reviewCount: number
      /** Ready analyses with aspect evidence. */
      analyzedReviewCount: number
      /** Ready v1-era analyses that predate aspect extraction. */
      preAspectAnalysisCount: number
      impactVersion: typeof ASPECT_IMPACT_VERSION
      /** Descending by mention count, then stable aspect/polarity identity. */
      aspects: readonly AiAspectAggregate[]
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
  authorization: AiAuthorizationPort
  processingProfiles: PropertyProcessingProfilePort
  aggregates: AiPropertyAggregateStorePort
  calendar: AiPropertyCalendarPort
  nowEpochMillis: () => number
}>

export type ReadPropertyAggregatesInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  actorUserId: UserId
  /** Window length in property-local days, inclusive of today. */
  days: number
}>

export function createReadPropertyAggregates(
  dependencies: ReadPropertyAggregatesDependencies,
): (input: ReadPropertyAggregatesInput) => Promise<AiPropertyAggregateWindowRead> {
  return async (input) => {
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
    // `readWindow` returns null while the aggregate head, the review head and
    // the cursor disagree, i.e. mid-flight. Reporting zeroes then would look
    // like "no reviews" rather than "not settled yet".
    if (window === null) return { status: 'preparing' }

    return {
      status: 'ready',
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
  'status' | 'startLocalDate' | 'endLocalDate'
> {
  const aspectTotals = new Map<
    string,
    {
      aspect: AiAspectAggregate['aspect']
      polarity: AiAspectAggregate['polarity']
      mentionCount: number
      impact: number
    }
  >()
  const sentimentTotals = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  let reviewCount = 0
  const sentimentByDay: AiSentimentDay[] = []
  let analyzedReviewCount = 0
  let preAspectAnalysisCount = 0

  for (const day of days) {
    reviewCount += day.reviewCount
    for (const mention of day.aspectCounts) {
      const key = `${mention.aspect}:${mention.polarity}`
      const total = aspectTotals.get(key) ?? {
        aspect: mention.aspect,
        polarity: mention.polarity,
        mentionCount: 0,
        impact: 0,
      }
      total.mentionCount += mention.count
      aspectTotals.set(key, total)
    }
    sentimentTotals.positive += day.sentimentCounts.positive
    sentimentTotals.neutral += day.sentimentCounts.neutral
    sentimentTotals.negative += day.sentimentCounts.negative
    sentimentTotals.mixed += day.sentimentCounts.mixed
    sentimentByDay.push({ localDate: day.localDate, ...day.sentimentCounts })
  }

  const issueCounts = new Map<string, number>()
  for (const review of analyzedReviews) {
    if (review.aspects.length === 0) {
      preAspectAnalysisCount += 1
    } else {
      analyzedReviewCount += 1
    }
    for (const mention of review.aspects) {
      const key = `${mention.aspect}:${mention.polarity}`
      const total = aspectTotals.get(key)
      if (total) {
        total.impact += computeAspectImpact({ ...mention, rating: review.rating })
      }
    }
    if (review.issueLabel !== null && isAiIssueLabel(review.issueLabel)) {
      issueCounts.set(review.issueLabel, (issueCounts.get(review.issueLabel) ?? 0) + 1)
    }
  }

  const aspects = [...aspectTotals.values()].sort(
    (a, b) =>
      b.mentionCount - a.mentionCount ||
      a.aspect.localeCompare(b.aspect) ||
      a.polarity.localeCompare(b.polarity),
  )
  const emergingIssues = [...issueCounts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5)

  return {
    reviewCount,
    analyzedReviewCount,
    preAspectAnalysisCount,
    impactVersion: ASPECT_IMPACT_VERSION,
    aspects,
    emergingIssues,
    sentimentByDay,
    sentimentTotals,
  }
}
