// Portal context — property-assignment access guard.
// Wraps the shared isPropertyAccessible helper with portalError construction.
// D6-001: PropertyManager mutations must verify the caller's staff_assignment
// includes the targeted property. AccountAdmin bypasses.

import type { PortalRepository } from './ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalId, PropertyId } from '#/shared/domain/ids'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import { portalError } from '../domain/errors'

/** Assert the caller's staff_assignment includes `propertyId`.
 *  AccountAdmin bypasses (getAccessiblePropertyIds returns null).
 *  Use when propertyId is already resolved (portal/group loaded, or input.propertyId). */
export async function assertPropertyAccess(
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  propertyId: PropertyId,
): Promise<void> {
  const accessible = await isPropertyAccessible(
    (orgId, userId, orgWide) =>
      staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx.organizationId,
    ctx.userId,
    ctx.role === 'AccountAdmin',
    propertyId,
  )
  if (!accessible) {
    throw portalError('forbidden', 'No access to this property', { propertyId })
  }
}

/** Resolve `portalId` → propertyId via the repo, then assert assignment access.
 *  Throws portal_not_found if the portal doesn't exist in the org.
 *  Use when only a portalId is known (link/category mutations). */
export async function assertPortalPropertyAccess(
  portalRepo: PortalRepository,
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  portalId: PortalId,
): Promise<void> {
  const portal = await portalRepo.findById(ctx.organizationId, portalId)
  if (!portal) {
    throw portalError('portal_not_found', 'portal not found in this organization')
  }
  await assertPropertyAccess(staffPublicApi, ctx, portal.propertyId)
}
