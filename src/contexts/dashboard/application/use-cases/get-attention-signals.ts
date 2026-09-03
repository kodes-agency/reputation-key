// Dashboard context — getAttentionSignals use case.
// Aggregates the five attention-band reasons plus their distinct work total.
// Authorization is enforced at the router/loader level (property ownership).

import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { AttentionSignals } from '../../domain/types'
import type { AttentionCounts } from '../ports/attention-signals.port'
import type { ReviewStatsPort } from '../ports/review-stats.port'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { priorPeriodDates, ratingComparison, RATING_DROP_THRESHOLD } from '../utils'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'

export type GetAttentionSignalsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  propertyTimezone: string
}>

export type GetAttentionSignalsDeps = Readonly<{
  signals: AttentionSignalsPort
  reviewStats: Pick<ReviewStatsPort, 'getPeriodStats'>
  inboxTargets: Pick<InboxPublicApi, 'getGoogleReviewTargetCountsByProperty'>
  clock: () => Date
}>

/** Concrete handler type — the curried use case after dependency injection. */
export type GetAttentionSignals = (
  input: GetAttentionSignalsInput,
) => Promise<AttentionSignals>

export function attentionSignalsFrom(
  counts: AttentionCounts,
  rating: Readonly<{
    currentAverage: number | null
    currentCount: number
    priorAverage: number | null
    priorCount: number
  }>,
): AttentionSignals {
  const comparison = ratingComparison(
    rating.currentAverage,
    rating.currentCount,
    rating.priorAverage,
    rating.priorCount,
  )
  const ratingDrop = comparison !== null && comparison <= -RATING_DROP_THRESHOLD

  return {
    overdue: counts.overdue,
    itemsToTriage: counts.itemsToTriage,
    goalsBehindPace: counts.goalsBehindPace,
    ratingDrop,
    escalated: counts.escalated,
    needsAttention: counts.attentionWork + (ratingDrop ? 1 : 0),
  }
}

export const getAttentionSignals =
  (deps: GetAttentionSignalsDeps): GetAttentionSignals =>
  async (input) => {
    const {
      organizationId,
      propertyId,
      startDate,
      endDate,
      timeRange,
      propertyTimezone,
    } = input
    const now = deps.clock()

    // Keep the attention band aligned with the KPI strip. An all-time window
    // has no meaningful predecessor, so the repository receives no comparison.
    const comparisonPeriod = priorPeriodDates(
      timeRange,
      startDate,
      endDate,
      propertyTimezone,
    )

    const [counts, targetCounts, current, prior] = await Promise.all([
      deps.signals.getAttentionCounts(organizationId, propertyId),
      deps.inboxTargets.getGoogleReviewTargetCountsByProperty({
        organizationId,
        propertyIds: [propertyId],
        now,
      }),
      deps.reviewStats.getPeriodStats(organizationId, propertyId, startDate, endDate),
      comparisonPeriod
        ? deps.reviewStats.getPeriodStats(
            organizationId,
            propertyId,
            comparisonPeriod.priorStartDate,
            comparisonPeriod.priorEndDate,
          )
        : Promise.resolve(null),
    ])

    return attentionSignalsFrom(
      {
        ...counts,
        overdue: targetCounts.get(propertyId)?.overdueCount ?? 0,
      },
      {
        currentAverage: current.avgRating,
        currentCount: current.count,
        priorAverage: prior?.avgRating ?? null,
        priorCount: prior?.count ?? 0,
      },
    )
  }
