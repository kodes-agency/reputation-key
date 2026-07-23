// Dashboard context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the dashboard context.
//
// Facade ports per ADR-0007: dashboard never queries review/reply/metric
// tables directly — the build constructs the SQL adapters itself and the
// dashboard repo only composes.

import type { Database } from '#/shared/db'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { createReviewStatsAdapter } from './infrastructure/adapters/review-stats.adapter'
import { createMetricStatsAdapter } from './infrastructure/adapters/metric-stats.adapter'
import { createPortalMetricsAdapter } from './infrastructure/adapters/portal-metrics.adapter'
import { createAttentionSignalsAdapter } from './infrastructure/adapters/attention-signals.adapter'
import { createStaffPortalResolverAdapter } from './infrastructure/adapters/staff-portal-resolver.adapter'
import { getDashboardData } from './application/use-cases/get-dashboard-data'
import { getPortalAnalytics } from './application/use-cases/get-portal-analytics'
import { getStaffDashboardData } from './application/use-cases/get-staff-dashboard-data'
import { getAttentionSignals } from './application/use-cases/get-attention-signals'
import type { GetAttentionSignals } from './application/use-cases/get-attention-signals'
import { getFleetOverview } from './application/use-cases/get-fleet-overview'
import type { GetFleetOverview } from './application/use-cases/get-fleet-overview'

export type DashboardContextBuildInput = Readonly<{
  db: Database
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export type DashboardContextApi = Readonly<{
  publicApi: Readonly<{
    getDashboardData: ReturnType<typeof getDashboardData>
    getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
    getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
    getAttentionSignals: GetAttentionSignals
    getFleetOverview: GetFleetOverview
  }>
  internal: Readonly<{
    repos: Readonly<{ dashboardRepo: ReturnType<typeof createDashboardRepository> }>
    useCases: Readonly<{
      getDashboardData: ReturnType<typeof getDashboardData>
      getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
      getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
      getAttentionSignals: GetAttentionSignals
      getFleetOverview: GetFleetOverview
    }>
  }>
}>

export const buildDashboardContext = (
  input: DashboardContextBuildInput,
): DashboardContextApi => {
  // Facade ports per ADR-0007 — SQL adapters are dashboard-owned
  // infrastructure; the repo only composes.
  const reviewStats = createReviewStatsAdapter(input.db)
  const metricStats = createMetricStatsAdapter(input.db)
  const portalMetrics = createPortalMetricsAdapter(input.db)
  const attentionSignals = createAttentionSignalsAdapter(input.db, input.clock)
  const staffPortalResolver = createStaffPortalResolverAdapter(input.staffPublicApi)

  const dashboardRepo = createDashboardRepository(reviewStats, metricStats)

  const getDashboard = getDashboardData({
    repo: dashboardRepo,
    clock: input.clock,
  })

  const getPortal = getPortalAnalytics({
    repo: dashboardRepo,
    portalMetrics,
    clock: input.clock,
  })

  const getStaffDashboard = getStaffDashboardData({
    repo: dashboardRepo,
    staffPortalResolver,
    clock: input.clock,
  })

  const getAttention = getAttentionSignals({
    repo: dashboardRepo,
    signals: attentionSignals,
    clock: input.clock,
  })

  const getFleet = getFleetOverview({
    repo: dashboardRepo,
    signals: attentionSignals,
    clock: input.clock,
  })

  return {
    publicApi: {
      getDashboardData: getDashboard,
      getPortalAnalytics: getPortal,
      getStaffDashboardData: getStaffDashboard,
      getAttentionSignals: getAttention,
      getFleetOverview: getFleet,
    },
    internal: {
      repos: { dashboardRepo },
      useCases: {
        getDashboardData: getDashboard,
        getPortalAnalytics: getPortal,
        getStaffDashboardData: getStaffDashboard,
        getAttentionSignals: getAttention,
        getFleetOverview: getFleet,
      },
    },
  }
}
