// Dashboard context — getStaffDashboardData use case
// Resolves assigned portals for a staff user and queries KPIs across those portals.
// Authorization is enforced at the server function level. No auth logic here.

import type { DashboardRepository } from '../ports/dashboard.repository'
import type { StaffPortalResolverPort } from '../ports/staff-portal-resolver.port'
import type { OrganizationId, PropertyId, PortalId, UserId } from '#/shared/domain/ids'
import type { StaffDashboardData } from '../../domain/types'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import type { AuthContext } from '#/shared/domain/auth-context'

export type GetStaffDashboardDataInput = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  portalId?: PortalId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
}>

export type GetStaffDashboardDataDeps = Readonly<{
  repo: DashboardRepository
  staffPortalResolver: StaffPortalResolverPort
}>
export type GetStaffDashboardData = ReturnType<typeof getStaffDashboardData>

const emptyKPIs = {
  reviews: { value: 0, priorValue: 0, trend: null },
  avgRating: { value: 0, priorValue: 0, trend: null },
  scans: { value: 0, priorValue: 0, trend: null },
  feedback: { value: 0, priorValue: 0, trend: null },
} as const

export const getStaffDashboardData =
  (deps: GetStaffDashboardDataDeps) =>
  async (
    input: GetStaffDashboardDataInput,
    ctx: AuthContext,
  ): Promise<StaffDashboardData> => {
    const {
      organizationId,
      userId,
      propertyId,
      portalId: filterPortalId,
      startDate,
      endDate,
      timeRange,
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

    // For 'all' time range, no meaningful prior period — skip trend comparison
    const priorStartDate =
      timeRange === 'all'
        ? startDate
        : new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
    const priorEndDate = timeRange === 'all' ? endDate : new Date(startDate.getTime() - 1)

    const kpis = await deps.repo.getKPIsForPortals({
      organizationId,
      propertyId,
      portalIds,
      startDate,
      endDate,
      priorStartDate,
      priorEndDate,
    })

    return { kpis, hasAssignments: true }
  }
