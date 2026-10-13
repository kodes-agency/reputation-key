// Reporting — the Property decision every Property-scoped dashboard read makes
// first (docs/standards.md §2.2 step 1; D6-001).
//
// The reader must belong to the Organization, hold `dashboard.read`, and reach
// every Property the read names: an Organization-wide holder reaches all of
// them, a manager only the Properties currently granted. It used to be asked by
// each server function, so a caller that was not one (a job, another context,
// a script) read any Property of the Organization.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  mayUsePermissionOnProperties,
  mayUsePermissionsOnProperties,
  type PropertyAccessLookup,
} from '#/shared/domain/property-access'
import { dashboardError } from '../domain/dashboard-errors'

/** Identity's current-grant lookup, as the composition root binds it. */
export type DashboardPropertyAccess = PropertyAccessLookup

type DashboardReadScope = Readonly<{
  organizationId: OrganizationId
  propertyIds: ReadonlyArray<PropertyId>
}>

/** Refuse, as a tagged `forbidden`, a reader who may not read these Properties. */
export async function requireDashboardPropertyAccess(
  propertyAccess: DashboardPropertyAccess,
  ctx: AuthContext,
  scope: DashboardReadScope,
): Promise<void> {
  if (
    !(await mayUsePermissionOnProperties(propertyAccess, ctx, 'dashboard.read', scope))
  ) {
    throw dashboardError('forbidden', 'Property not assigned to caller')
  }
}

/**
 * The Property overview and its attention band also carry work state
 * `dashboard.read` alone does not reach: reply targets past due, items to
 * triage, escalations (§9). A Member holds `dashboard.read` for the staff
 * dashboard and must not read them, so their reader needs
 * `dashboard.fleet_read` as well, held and reaching the Property: what the
 * overview's server function asks the execution policy. One grant lookup
 * answers both permissions.
 */
export async function requirePropertyOverviewAccess(
  propertyAccess: DashboardPropertyAccess,
  ctx: AuthContext,
  scope: DashboardReadScope,
): Promise<void> {
  const allowed = await mayUsePermissionsOnProperties(
    propertyAccess,
    ctx,
    ['dashboard.read', 'dashboard.fleet_read'],
    scope,
  )
  if (!allowed) {
    throw dashboardError('forbidden', 'Property overview is not readable by this caller')
  }
}
