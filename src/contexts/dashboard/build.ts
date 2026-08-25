// Dashboard context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the dashboard context.
// Review-detail reads cross the review-owned governed serving interface.
// Fleet overview uses a dashboard-owned bulk projection because the per-property
// serving facade would create an O(N) fan-out; that projection repeats the same
// tenant and source-eligibility predicates in one bounded statement.

import type { Database } from '#/shared/db'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ReviewServingStats } from '#/contexts/review/application/public-api'
import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { createMetricStatsAdapter } from './infrastructure/adapters/metric-stats.adapter'
import { createAttentionSignalsAdapter } from './infrastructure/adapters/attention-signals.adapter'
import { createFleetOverviewProjectionAdapter } from './infrastructure/adapters/fleet-overview-projection.adapter'
import { createStaffPortalResolverAdapter } from './infrastructure/adapters/staff-portal-resolver.adapter'
import { getDashboardData } from './application/use-cases/get-dashboard-data'
import { getPortalAnalytics } from './application/use-cases/get-portal-analytics'
import { getStaffDashboardData } from './application/use-cases/get-staff-dashboard-data'
import { getAttentionSignals } from './application/use-cases/get-attention-signals'
import type { GetAttentionSignals } from './application/use-cases/get-attention-signals'
import { getFleetOverview } from './application/use-cases/get-fleet-overview'
import type { GetFleetOverview } from './application/use-cases/get-fleet-overview'
import type { PortalResponseIntegrityPort } from './application/ports/portal-response-integrity.port'
import type { PortalMetricsPort } from './application/ports/portal-metrics.port'

export type DashboardContextBuildInput = Readonly<{
  db: Database
  staffPublicApi: StaffPublicApi
  clock: () => Date
  /**
   * BQC-5.5: review-owned governed serving stats (ADR 0031 eligibility
   * enforced at the owner). Composition wires review.internal.servingStats
   * here; structurally satisfies ReviewStatsPort.
   */
  reviewServingStats: ReviewServingStats
  guestResponseIntegrity: PortalResponseIntegrityPort
  /** Metric-owned governed Portal analytics public API. */
  portalMetrics: PortalMetricsPort
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
  // Facade ports per ADR-0007 — review and Portal metrics arrive governed from
  // their owning contexts; remaining Dashboard-owned adapters only read
  // Dashboard-owned projections.
  const metricStats = createMetricStatsAdapter(input.db)
  const attentionSignals = createAttentionSignalsAdapter(input.db, input.clock)
  const fleetOverviewProjection = createFleetOverviewProjectionAdapter(input.db)
  const staffPortalResolver = createStaffPortalResolverAdapter(input.staffPublicApi)

  const dashboardRepo = createDashboardRepository(input.reviewServingStats, metricStats)

  const getDashboard = getDashboardData({
    repo: dashboardRepo,
    clock: input.clock,
  })

  const getPortal = getPortalAnalytics({
    portalMetrics: input.portalMetrics,
    responseIntegrity: input.guestResponseIntegrity,
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
    projection: fleetOverviewProjection,
    resolveAccessiblePropertyIds: (organizationId, scope) =>
      input.staffPublicApi.getAccessiblePropertyIds(
        organizationId,
        scope.userId,
        scope.organizationWide,
      ),
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
