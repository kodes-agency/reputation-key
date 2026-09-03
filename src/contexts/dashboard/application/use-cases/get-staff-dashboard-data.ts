// Dashboard context — getStaffDashboardData use case
// Resolves assigned portals for a staff user and queries KPIs across those portals.
// Per architecture: application use case owns authorization.

import { canForContext } from '#/shared/domain/permissions'
import { dashboardError } from '../../domain/errors'
import type { DashboardRepository } from '../ports/dashboard.repository'
import type { StaffPortalResolverPort } from '../ports/staff-portal-resolver.port'
import type { OrganizationId, PropertyId, PortalId, UserId } from '#/shared/domain/ids'
import type { KPIs, StaffDashboardData } from '../../domain/types'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import type { AuthContext } from '#/shared/domain/auth-context'
import { priorPeriodDates } from '../utils'

export type GetStaffDashboardDataInput = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  portalId?: PortalId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  propertyTimezone: string
}>

export type GetStaffDashboardDataDeps = Readonly<{
  repo: DashboardRepository
  staffPortalResolver: StaffPortalResolverPort
  clock: () => Date
}>
export type GetStaffDashboardData = ReturnType<typeof getStaffDashboardData>

const unavailableMetricKpi = {
  value: null,
  priorValue: null,
  trend: null,
  evidence: {
    current: {
      state: 'temporarily_unavailable',
      definitionVersionId: null,
      sampleCount: 0,
      minimumSample: null,
    },
    prior: null,
  },
} as const

const emptyKPIs: KPIs = {
  reviews: { value: 0, priorValue: 0, trend: null },
  avgRating: {
    value: null,
    priorValue: null,
    comparison: null,
    sampleCount: 0,
    priorSampleCount: 0,
    evidence: {
      definitionVersionId: null,
      state: 'insufficient_data',
      verifiedThrough: null,
      latestActivity: null,
      computedAt: new Date(0),
      completeness: 1,
      availabilityReason: null,
      correctionHead: null,
      sampleCount: 0,
    },
  },
  scans: unavailableMetricKpi,
  feedback: unavailableMetricKpi,
}

export const getStaffDashboardData =
  (deps: GetStaffDashboardDataDeps) =>
  async (
    input: GetStaffDashboardDataInput,
    ctx: AuthContext,
  ): Promise<StaffDashboardData> => {
    if (!canForContext(ctx, 'dashboard.read')) {
      throw dashboardError('forbidden', 'Insufficient permissions to view dashboard')
    }

    const {
      organizationId,
      userId,
      propertyId,
      portalId: filterPortalId,
      startDate,
      endDate,
      timeRange,
      propertyTimezone,
    } = input

    // Resolve assigned portals via the port (cross-context call to staff)
    const assignedPortals = await deps.staffPortalResolver({ userId, propertyId }, ctx)

    // If a filter portalId is provided, scope to just that portal
    const portalIds = filterPortalId
      ? assignedPortals.filter((p) => p === filterPortalId)
      : assignedPortals

    // No portals → empty KPIs, no assignments
    if (portalIds.length === 0) {
      return { kpis: { ...emptyKPIs }, hasAssignments: assignedPortals.length > 0 }
    }

    const comparisonPeriod = priorPeriodDates(
      timeRange,
      startDate,
      endDate,
      propertyTimezone,
    )

    const kpis = await deps.repo.getKPIsForPortals({
      organizationId,
      propertyId,
      portalIds,
      startDate,
      endDate,
      comparisonPeriod,
    })

    return { kpis, hasAssignments: true }
  }
