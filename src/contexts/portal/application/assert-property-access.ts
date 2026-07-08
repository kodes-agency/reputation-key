// Portal context — property-assignment access guard.
// Wraps the shared isPropertyAccessibleForPermission helper with portalError
// construction. D6-001: PropertyManager mutations must verify the caller's
// staff_assignment includes the targeted property. Scope is resolved
// PER PERMISSION via scopeForPermission so a custom role with
// portal.update@organization gets org-wide access for updates but a custom
// role with portal.update@assigned stays scoped.

import type { PortalRepository } from './ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalId, PropertyId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { portalError } from '../domain/errors'

/** Assert the caller's staff_assignment includes `propertyId`.
 *  `permission` governs the scope decision (org-wide vs assigned) — pass the
 *  same permission the caller gated on (portal.read/create/update/delete).
 *  Use when propertyId is already resolved (portal/group loaded, or input.propertyId). */
export async function assertPropertyAccess(
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  permission: Permission,
  propertyId: PropertyId,
): Promise<void> {
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, userId, orgWide) =>
      staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx,
    permission,
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
  permission: Permission,
  portalId: PortalId,
): Promise<void> {
  const portal = await portalRepo.findById(ctx.organizationId, portalId)
  if (!portal) {
    throw portalError('portal_not_found', 'portal not found in this organization')
  }
  await assertPropertyAccess(staffPublicApi, ctx, permission, portal.propertyId)
}
