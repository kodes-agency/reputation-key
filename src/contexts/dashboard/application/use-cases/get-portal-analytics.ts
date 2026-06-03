// Dashboard context — getPortalAnalytics use case
// Orchestrates portal-scoped queries into a single PortalAnalyticsData response.
// Authorization is enforced at the router/loader level (property ownership). No auth logic here.

import type { DashboardRepository } from '../ports/dashboard.repository'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { PortalAnalyticsData, PortalKPIs } from '../../domain/types'
import type { PortalMetricsPort } from '../ports/portal-metrics.port'
import type { TimeRangePreset } from '../dto/dashboard.dto'

export type GetPortalAnalyticsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
}>

export type GetPortalAnalyticsDeps = Readonly<{
  repo: DashboardRepository
  portalMetrics: PortalMetricsPort
}>
export type GetPortalAnalytics = ReturnType<typeof getPortalAnalytics>

/** Compute trend percentage. Returns null when prior is 0 or result is not finite. */
function trend(current: number, prior: number): number | null {
  if (prior === 0) return null
  const result = ((current - prior) / prior) * 100
  return Number.isFinite(result) ? Math.round(result) : null
}

export const getPortalAnalytics =
  (deps: GetPortalAnalyticsDeps) =>
  async (input: GetPortalAnalyticsInput): Promise<PortalAnalyticsData> => {
    const { organizationId, propertyId, portalId, startDate, endDate, timeRange } = input

    // For 'all' time range, no meaningful prior period — skip trend comparison
    const priorStartDate =
      timeRange === 'all'
        ? startDate
        : new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
    const priorEndDate = timeRange === 'all' ? endDate : new Date(startDate.getTime() - 1)

    // Fetch current and prior KPI sums, rating distribution, rating trend, and engagement funnel in parallel
    const [currentSums, priorSums, ratingDistribution, ratingTrend, engagementFunnel] =
      await Promise.all([
        deps.portalMetrics.getPortalKpiSums(
          organizationId,
          propertyId,
          portalId,
          startDate,
          endDate,
        ),
        deps.portalMetrics.getPortalKpiSums(
          organizationId,
          propertyId,
          portalId,
          priorStartDate,
          priorEndDate,
        ),
        deps.portalMetrics.getPortalRatingDistribution(
          organizationId,
          propertyId,
          portalId,
          startDate,
          endDate,
        ),
        deps.portalMetrics.getPortalRatingTrend(
          organizationId,
          propertyId,
          portalId,
          startDate,
          endDate,
        ),
        deps.repo.getEngagementFunnel({
          organizationId,
          propertyId,
          portalId,
          startDate,
          endDate,
        }),
      ])

    const toMap = (
      rows: readonly { metricKey: string; total: number; count: number }[],
    ) => new Map(rows.map((r) => [r.metricKey, r]))

    const cur = toMap(currentSums)
    const prior = toMap(priorSums)

    const curScans = cur.get('portal.scan')
    const priorScans = prior.get('portal.scan')
    const curFeedback = cur.get('portal.feedback')
    const priorFeedback = prior.get('portal.feedback')
    const curRating = cur.get('portal.rating')
    const priorRating = prior.get('portal.rating')
    const curReviewLink = cur.get('portal.review_link_click')
    const priorReviewLink = prior.get('portal.review_link_click')

    // avgRating: total / count (0 if no ratings)
    const curAvgRating = curRating ? curRating.total / Math.max(1, curRating.count) : 0
    const priorAvgRating = priorRating
      ? priorRating.total / Math.max(1, priorRating.count)
      : 0

    const kpis: PortalKPIs = {
      scans: {
        value: curScans?.total ?? 0,
        priorValue: priorScans?.total ?? 0,
        trend: trend(curScans?.total ?? 0, priorScans?.total ?? 0),
      },
      avgRating: {
        value: Math.round(curAvgRating * 10) / 10,
        priorValue: Math.round(priorAvgRating * 10) / 10,
        trend: trend(curAvgRating, priorAvgRating),
      },
      feedback: {
        value: curFeedback?.total ?? 0,
        priorValue: priorFeedback?.total ?? 0,
        trend: trend(curFeedback?.total ?? 0, priorFeedback?.total ?? 0),
      },
      reviewLinkClicks: {
        value: curReviewLink?.total ?? 0,
        priorValue: priorReviewLink?.total ?? 0,
        trend: trend(curReviewLink?.total ?? 0, priorReviewLink?.total ?? 0),
      },
    }

    return { kpis, engagementFunnel, ratingDistribution, ratingTrend: [...ratingTrend] }
  }
