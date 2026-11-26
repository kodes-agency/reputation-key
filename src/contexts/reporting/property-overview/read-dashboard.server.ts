// Orchestrates all repo queries into a single DashboardData response and hides
// reply state from a reader who may not manage replies. The caller authorizes
// the reader for the Property first.

import type { DashboardRepository } from './dashboard-repository.port.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
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
  portalId: PortalId | null
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
  const {
    organizationId,
    propertyId,
    portalId,
    startDate,
    endDate,
    timeRange,
    propertyTimezone,
  } = input
  const comparisonPeriod = priorPeriodDates(
    timeRange,
    startDate,
    endDate,
    propertyTimezone,
  )

  // Fire all queries in parallel — engagementFunnel is conditional but still
  // runs concurrently when portalId is set, avoiding a sequential round-trip.
  const [
    kpis,
    ratingDistribution,
    ratingTrend,
    reviewVolume,
    replyPerformance,
    recentReviews,
    engagementFunnel,
  ] = await Promise.all([
    repo.getKPIs({
      organizationId,
      propertyId,
      portalId: portalId ?? undefined,
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
    portalId
      ? repo.getEngagementFunnel({
          organizationId,
          propertyId,
          portalId,
          startDate,
          endDate,
        })
      : Promise.resolve(null),
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
    engagementFunnel,
    recentReviews,
  })
}
