// Dashboard context — getDashboardData use case
// Orchestrates all repo queries into a single DashboardData response.
// Authorization is enforced at the router/loader level (property ownership). No auth logic here.

import type { DashboardRepository } from '../ports/dashboard.repository'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { DashboardData } from '../../domain/types'

export type GetDashboardDataInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  startDate: Date
  endDate: Date
}>

export type GetDashboardDataDeps = Readonly<{
  repo: DashboardRepository
}>

/** Compute prior period dates (same length as current, immediately before). */
function priorPeriod(start: Date, end: Date): { priorStartDate: Date; priorEndDate: Date } {
  const duration = end.getTime() - start.getTime()
  return {
    priorStartDate: new Date(start.getTime() - duration),
    priorEndDate: new Date(start.getTime()),
  }
}

export const getDashboardData =
  (deps: GetDashboardDataDeps) =>
  async (input: GetDashboardDataInput): Promise<DashboardData> => {
    const { organizationId, propertyId, portalId, startDate, endDate } = input
    const { priorStartDate, priorEndDate } = priorPeriod(startDate, endDate)

    const { repo } = deps

    // Fire all queries in parallel
    const [kpis, ratingDistribution, ratingTrend, reviewVolume, replyPerformance, recentReviews] =
      await Promise.all([
        repo.getKPIs({
          organizationId,
          propertyId,
          startDate,
          endDate,
          priorStartDate,
          priorEndDate,
        }),
        repo.getRatingDistribution({ organizationId, propertyId, startDate, endDate }),
        repo.getRatingTrend({ organizationId, propertyId, startDate, endDate }),
        repo.getReviewVolume({ organizationId, propertyId, startDate, endDate }),
        repo.getReplyPerformance({ organizationId, propertyId, startDate, endDate }),
        repo.getRecentReviews({ organizationId, propertyId, limit: 5 }),
      ])

    // Engagement funnel only when portal is selected
    const engagementFunnel = portalId
      ? await repo.getEngagementFunnel({ organizationId, propertyId, portalId, startDate, endDate })
      : null

    return {
      kpis,
      ratingDistribution,
      ratingTrend,
      reviewVolume,
      replyPerformance,
      engagementFunnel,
      recentReviews,
    }
  }
