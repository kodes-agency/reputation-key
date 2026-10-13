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
  type PropertyAccessLookup,
} from '#/shared/domain/property-access'
import { dashboardError } from '../domain/dashboard-errors'

/** Identity's current-grant lookup, as the composition root binds it. */
export type DashboardPropertyAccess = PropertyAccessLookup

/** Refuse, as a tagged `forbidden`, a reader who may not read these Properties. */
export async function requireDashboardPropertyAccess(
  propertyAccess: DashboardPropertyAccess,
  ctx: AuthContext,
  scope: Readonly<{
    organizationId: OrganizationId
    propertyIds: ReadonlyArray<PropertyId>
  }>,
): Promise<void> {
  if (
    !(await mayUsePermissionOnProperties(propertyAccess, ctx, 'dashboard.read', scope))
  ) {
    throw dashboardError('forbidden', 'Property not assigned to caller')
  }
}
