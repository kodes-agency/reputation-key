// Dashboard context — D6-001 property-access guard for server functions
// (single source, BQC-5.9 E13).
//
// Non-admin callers may only read their assigned properties. Scope is
// resolved PER PERMISSION (dashboard.read): org-wide scope → all
// accessible; assigned scope → staff_assignment properties.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { propertyId } from '#/shared/domain/ids'

/** Throw the DashboardError-shaped forbidden when the caller may not read the property. */
export async function assertDashboardPropertyAccessible(
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  rawPropertyId: string,
): Promise<void> {
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, uId, orgWide) => staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
    ctx,
    'dashboard.read',
    propertyId(rawPropertyId),
  )
  if (!accessible) {
    // Server layer must not import domain error constructors — the same
    // literal shape the server functions constructed locally.
    throw {
      _tag: 'DashboardError' as const,
      code: 'forbidden' as const,
      message: 'Property not assigned to caller',
    }
  }
}
