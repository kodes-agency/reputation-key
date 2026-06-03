// Dashboard context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the dashboard context.

import type { ReviewStatsPort } from './application/ports/review-stats.port'
import type { MetricStatsPort } from './application/ports/metric-stats.port'
import type { PortalMetricsPort } from './application/ports/portal-metrics.port'
import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { getDashboardData } from './application/use-cases/get-dashboard-data'
import { getPortalAnalytics } from './application/use-cases/get-portal-analytics'

export type DashboardContextBuildInput = Readonly<{
  reviewStats: ReviewStatsPort
  metricStats: MetricStatsPort
  portalMetrics: PortalMetricsPort
}>

export type DashboardContextApi = Readonly<{
  publicApi: Readonly<{
    getDashboardData: ReturnType<typeof getDashboardData>
    getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
  }>
  internal: Readonly<{
    repos: Readonly<{ dashboardRepo: ReturnType<typeof createDashboardRepository> }>
    useCases: Readonly<{
      getDashboardData: ReturnType<typeof getDashboardData>
      getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
    }>
  }>
}>

export const buildDashboardContext = (
  input: DashboardContextBuildInput,
): DashboardContextApi => {
  const dashboardRepo = createDashboardRepository(input.reviewStats, input.metricStats)

  const getDashboard = getDashboardData({
    repo: dashboardRepo,
  })

  const getPortal = getPortalAnalytics({
    repo: dashboardRepo,
    portalMetrics: input.portalMetrics,
  })

  return {
    publicApi: {
      getDashboardData: getDashboard,
      getPortalAnalytics: getPortal,
    },
    internal: {
      repos: { dashboardRepo },
      useCases: { getDashboardData: getDashboard, getPortalAnalytics: getPortal },
    },
  }
}
