// Orchestrates all repo queries into a single DashboardData response and hides
// reply state from a reader who may not manage replies. The caller authorizes
// the reader for the Property first.

import type { DashboardRepository } from './dashboard-repository.port.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type { DashboardData } from '../domain/dashboard-types'
import { hideReplyWorkflowWithoutAuthority } from '../domain/reply-workflow-redaction'
import type { TimeRangePreset } from './contracts'
import {
  DEFAULT_RECENT_REVIEWS_LIMIT,
  priorPeriodDates,
} from '../portal-results/time-range.server'

export type ReadDashboardInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  propertyTimezone: string
}>

export const readDashboard = async (
  repo: DashboardRepository,
  input: ReadDashboardInput,
  ctx: AuthContext,
): Promise<DashboardData> => {
  const { organizationId, propertyId, startDate, endDate, timeRange, propertyTimezone } =
    input
  const comparisonPeriod = priorPeriodDates(
    timeRange,
    startDate,
    endDate,
    propertyTimezone,
  )

  // Fire all queries in parallel.
  const [
    kpis,
    ratingDistribution,
    ratingTrend,
    reviewVolume,
    replyPerformance,
    recentReviews,
  ] = await Promise.all([
    repo.getKPIs({
      organizationId,
      propertyId,
      startDate,
      endDate,
      comparisonPeriod,
    }),
    repo.getRatingDistribution({ organizationId, propertyId, startDate, endDate }),
    repo.getRatingTrend({ organizationId, propertyId, startDate, endDate }),
    repo.getReviewVolume({ organizationId, propertyId, startDate, endDate }),
    repo.getReplyPerformance({ organizationId, propertyId, startDate, endDate }),
    repo.getRecentReviews({
      organizationId,
      propertyId,
      limit: DEFAULT_RECENT_REVIEWS_LIMIT,
    }),
  ])

  // §9: reply-derived fields (the reply aggregates and each review's reply
  // status) must not reach a reader without reply.manage. dashboard.read is
  // granted to roles the Reply glossary keeps reply state from.
  return hideReplyWorkflowWithoutAuthority(canForContext(ctx, 'reply.manage'), {
    kpis,
    ratingDistribution,
    ratingTrend,
    reviewVolume,
    replyPerformance,
    recentReviews,
  })
}
