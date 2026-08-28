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
import { getPropertyOverview } from './application/use-cases/get-property-overview'
import type { GetPropertyOverview } from './application/use-cases/get-property-overview'
import { getFleetOverview } from './application/use-cases/get-fleet-overview'
import type { GetFleetOverview } from './application/use-cases/get-fleet-overview'
import type { PortalResponseIntegrityPort } from './application/ports/portal-response-integrity.port'
import type { PortalMetricsPort } from './application/ports/portal-metrics.port'
import type { PortalLifetimeMetricsPort } from './application/ports/portal-lifetime-metrics.port'
import { createDashboardOrganizationExportAdapter } from './infrastructure/adapters/dashboard-organization-export.adapter'
import { createSetupChecklistRepository } from './infrastructure/repositories/setup-checklist.repository'
import { getSetupChecklist } from './application/use-cases/get-setup-checklist'
import type { GetSetupChecklist } from './application/use-cases/get-setup-checklist'

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
  /** Metric-owned anonymous All Time projection. */
  portalLifetime: PortalLifetimeMetricsPort
}>

export type DashboardContextApi = Readonly<{
  publicApi: Readonly<{
    getDashboardData: ReturnType<typeof getDashboardData>
    getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
    getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
    getAttentionSignals: GetAttentionSignals
    getPropertyOverview: GetPropertyOverview
    getFleetOverview: GetFleetOverview
    getSetupChecklist: GetSetupChecklist
  }>
  /**
   * LIF-01 Organization Export contributor. Deliberately outside `publicApi`:
   * only Identity's bundle builder consumes it, and no tenant-reachable
   * surface gains a key from wiring it here.
   */
  organizationExport: ReturnType<typeof createDashboardOrganizationExportAdapter>
  internal: Readonly<{
    repos: Readonly<{
      dashboardRepo: ReturnType<typeof createDashboardRepository>
      setupChecklistRepo: ReturnType<typeof createSetupChecklistRepository>
    }>
    useCases: Readonly<{
      getDashboardData: ReturnType<typeof getDashboardData>
      getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
      getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
      getAttentionSignals: GetAttentionSignals
      getPropertyOverview: GetPropertyOverview
      getFleetOverview: GetFleetOverview
      getSetupChecklist: GetSetupChecklist
    }>
  }>
}>

export const buildDashboardContext = (
  input: DashboardContextBuildInput,
): DashboardContextApi => {
  // Facade ports per ADR-0007 — review and Portal metrics arrive governed from
  // their owning contexts; remaining Dashboard-owned adapters only read
  // content-minimal, explicitly catalogued Dashboard read projections.
  const metricStats = createMetricStatsAdapter(input.db)
  const attentionSignals = createAttentionSignalsAdapter(input.db, input.clock)
  const fleetOverviewProjection = createFleetOverviewProjectionAdapter(input.db)
  const staffPortalResolver = createStaffPortalResolverAdapter(input.staffPublicApi)

  const dashboardRepo = createDashboardRepository(input.reviewServingStats, metricStats)
  const setupChecklistRepo = createSetupChecklistRepository(input.db)

  const getDashboard = getDashboardData({ repo: dashboardRepo })

  const getPortal = getPortalAnalytics({
    portalMetrics: input.portalMetrics,
    portalLifetime: input.portalLifetime,
    responseIntegrity: input.guestResponseIntegrity,
  })

  const getStaffDashboard = getStaffDashboardData({
    repo: dashboardRepo,
    staffPortalResolver,
    clock: input.clock,
  })

  const getAttention = getAttentionSignals({
    signals: attentionSignals,
    reviewStats: input.reviewServingStats,
  })

  const getOverview = getPropertyOverview({
    getDashboardData: getDashboard,
    attention: attentionSignals,
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
  const getSetup = getSetupChecklist({ repository: setupChecklistRepo })

  return {
    publicApi: {
      getDashboardData: getDashboard,
      getPortalAnalytics: getPortal,
      getStaffDashboardData: getStaffDashboard,
      getAttentionSignals: getAttention,
      getPropertyOverview: getOverview,
      getFleetOverview: getFleet,
      getSetupChecklist: getSetup,
    },
    organizationExport: createDashboardOrganizationExportAdapter(input.db),
    internal: {
      repos: { dashboardRepo, setupChecklistRepo },
      useCases: {
        getDashboardData: getDashboard,
        getPortalAnalytics: getPortal,
        getStaffDashboardData: getStaffDashboard,
        getAttentionSignals: getAttention,
        getPropertyOverview: getOverview,
        getFleetOverview: getFleet,
        getSetupChecklist: getSetup,
      },
    },
  }
}
