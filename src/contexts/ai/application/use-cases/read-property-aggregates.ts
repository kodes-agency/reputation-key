import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyDailyAggregate,
} from '../ports/ai-property-aggregate-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { addDays } from '../local-date'
import { resolveAiReadGate } from '../ai-read-gate'

export type AiCategoryCount = Readonly<{
  category: keyof AiPropertyDailyAggregate['categoryCounts']
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
 * What the property dashboard needs from `ai_property_daily_aggregates`: the
 * category mix over a window, and the sentiment split per day so it can be
 * drawn as a trend rather than a single number.
 */
export type AiPropertyAggregateWindowRead =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{
      status: 'ready'
      startLocalDate: string
      endLocalDate: string
      reviewCount: number
      /** Descending by count, then by category name so ties are stable. */
      categories: readonly AiCategoryCount[]
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
    // Category and sentiment are review-analysis derivatives, so this read is
    // gated on `review_analysis` rather than `property_trends`.
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
      ...summarize(window.days),
    }
  }
}

function summarize(
  days: readonly AiPropertyDailyAggregate[],
): Omit<
  Extract<AiPropertyAggregateWindowRead, { status: 'ready' }>,
  'status' | 'startLocalDate' | 'endLocalDate'
> {
  const categoryTotals = new Map<AiCategoryCount['category'], number>()
  const sentimentTotals = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  let reviewCount = 0
  const sentimentByDay: AiSentimentDay[] = []

  for (const day of days) {
    reviewCount += day.reviewCount
    for (const [category, count] of Object.entries(day.categoryCounts)) {
      const key = category as AiCategoryCount['category']
      categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + count)
    }
    sentimentTotals.positive += day.sentimentCounts.positive
    sentimentTotals.neutral += day.sentimentCounts.neutral
    sentimentTotals.negative += day.sentimentCounts.negative
    sentimentTotals.mixed += day.sentimentCounts.mixed
    sentimentByDay.push({ localDate: day.localDate, ...day.sentimentCounts })
  }

  const categories = [...categoryTotals.entries()]
    .map(([category, count]) => ({ category, count }))
    // Volume first, because the question the section answers is "what should I
    // fix?". Name breaks ties so the order never flickers between reads.
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))

  return { reviewCount, categories, sentimentByDay, sentimentTotals }
}
