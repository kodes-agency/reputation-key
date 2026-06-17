// Dashboard context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the dashboard context.

import type { ReviewStatsPort } from './application/ports/review-stats.port'
import type { MetricStatsPort } from './application/ports/metric-stats.port'
import type { PortalMetricsPort } from './application/ports/portal-metrics.port'
import type { StaffPortalResolverPort } from './application/ports/staff-portal-resolver.port'
import type { AttentionSignalsPort } from './application/ports/attention-signals.port'
import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { getDashboardData } from './application/use-cases/get-dashboard-data'
import { getPortalAnalytics } from './application/use-cases/get-portal-analytics'
import { getStaffDashboardData } from './application/use-cases/get-staff-dashboard-data'
import { getAttentionSignals } from './application/use-cases/get-attention-signals'
import type { GetAttentionSignals } from './application/use-cases/get-attention-signals'

export type DashboardContextBuildInput = Readonly<{
  reviewStats: ReviewStatsPort
  metricStats: MetricStatsPort
  portalMetrics: PortalMetricsPort
  staffPortalResolver: StaffPortalResolverPort
  attentionSignals: AttentionSignalsPort
}>

export type DashboardContextApi = Readonly<{
  publicApi: Readonly<{
    getDashboardData: ReturnType<typeof getDashboardData>
    getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
    getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
    getAttentionSignals: GetAttentionSignals
  }>
  internal: Readonly<{
    repos: Readonly<{ dashboardRepo: ReturnType<typeof createDashboardRepository> }>
    useCases: Readonly<{
      getDashboardData: ReturnType<typeof getDashboardData>
      getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
      getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
      getAttentionSignals: GetAttentionSignals
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

  const getStaffDashboard = getStaffDashboardData({
    repo: dashboardRepo,
    staffPortalResolver: input.staffPortalResolver,
  })

  const getAttention = getAttentionSignals({
    repo: dashboardRepo,
    signals: input.attentionSignals,
  })

  return {
    publicApi: {
      getDashboardData: getDashboard,
      getPortalAnalytics: getPortal,
      getStaffDashboardData: getStaffDashboard,
      getAttentionSignals: getAttention,
    },
    internal: {
      repos: { dashboardRepo },
      useCases: {
        getDashboardData: getDashboard,
        getPortalAnalytics: getPortal,
        getStaffDashboardData: getStaffDashboard,
        getAttentionSignals: getAttention,
      },
    },
  }
}
