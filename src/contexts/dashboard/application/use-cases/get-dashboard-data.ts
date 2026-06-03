// Dashboard context — getDashboardData use case
// Orchestrates all repo queries into a single DashboardData response.
// Authorization is enforced at the router/loader level (property ownership). No auth logic here.

import type { DashboardRepository } from '../ports/dashboard.repository'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { DashboardData } from '../../domain/types'
import type { TimeRangePreset } from '../dto/dashboard.dto'

export type GetDashboardDataInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
}>

export type GetDashboardDataDeps = Readonly<{
  repo: DashboardRepository
}>
export type GetDashboardData = ReturnType<typeof getDashboardData>

export const getDashboardData =
  (deps: GetDashboardDataDeps) =>
  async (input: GetDashboardDataInput): Promise<DashboardData> => {
    const { organizationId, propertyId, portalId, startDate, endDate, timeRange } = input

    // For 'all' time range, no meaningful prior period — skip trend comparison
    const priorStartDate =
      timeRange === 'all'
        ? startDate
        : new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
    const priorEndDate = timeRange === 'all' ? endDate : new Date(startDate.getTime() - 1)

    const { repo } = deps

    // Fire all queries in parallel
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
        portalId: portalId ?? undefined,
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
      ? await repo.getEngagementFunnel({
          organizationId,
          propertyId,
          portalId,
          startDate,
          endDate,
        })
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
