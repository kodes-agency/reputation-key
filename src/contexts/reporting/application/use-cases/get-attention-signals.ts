// Dashboard context — getAttentionSignals use case.
// Authorizes the reader for the Property's overview (the band is work state a
// `dashboard.read` holder without `dashboard.fleet_read` may not read), then
// aggregates the five attention-band reasons plus their distinct work total.

import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { AttentionSignals } from '../../domain/dashboard-types'
import type { AttentionCounts } from '../ports/attention-signals.port'
import type { ReviewStatsPort } from '../ports/review-stats.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import {
  requirePropertyOverviewAccess,
  type DashboardPropertyAccess,
} from '../dashboard-property-access'
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
  propertyAccess: DashboardPropertyAccess
}>

/** Concrete handler type — the curried use case after dependency injection. */
export type GetAttentionSignals = (
  input: GetAttentionSignalsInput,
  ctx: AuthContext,
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
  async (input, ctx) => {
    const {
      organizationId,
      propertyId,
      startDate,
      endDate,
      timeRange,
      propertyTimezone,
    } = input
    await requirePropertyOverviewAccess(deps.propertyAccess, ctx, {
      organizationId,
      propertyIds: [propertyId],
    })
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
