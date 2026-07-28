// Portal context — portal/group access preludes (single source, BQC-5.9 E11).
//
// The portal mutation use cases share three prologue shapes: authorize +
// load portal + assignment access; authorize + load group + assignment
// access (membership mutations); authorize + property exists + assignment
// access (creates). They exist once here, over the assert-property-access
// guard, so the D6-001 scoping decision cannot drift between use cases.

import type { PortalRepository } from './ports/portal.repository'
import type { PortalGroupRepository } from './ports/portal-group.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Portal, PortalGroup } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalGroupId, PortalId, PropertyId } from '#/shared/domain/ids'
import { portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../domain/errors'
import { assertPropertyAccess } from './assert-property-access'

/**
 * Authorize `permission`, load the portal, and assert the caller's
 * assignment includes its property (D6-001). `forbiddenMessage` is the
 * use-case-specific authorization failure message.
 */
export async function loadPortalOrThrow(
  deps: Readonly<{
    portalRepo: PortalRepository
    staffPublicApi: StaffPublicApi
  }>,
  ctx: AuthContext,
  id: PortalId,
  opts: { permission: Permission; forbiddenMessage: string },
): Promise<Portal> {
  if (!canForContext(ctx, opts.permission)) {
    throw portalError('forbidden', opts.forbiddenMessage)
  }
  const portal = await deps.portalRepo.findById(ctx.organizationId, id)
  if (!portal) {
    throw portalError('portal_not_found', 'portal not found in this organization')
  }
  await assertPropertyAccess(deps.staffPublicApi, ctx, opts.permission, portal.propertyId)
  return portal
}

/**
 * Membership-mutation prologue: authorize portal.update, brand the ids,
 * load the group, and assert assignment access to the group's property
 * (D6-001).
 */
export async function loadGroupAndPortalForMembership(
  deps: Readonly<{
    portalGroupRepo: PortalGroupRepository
    staffPublicApi: StaffPublicApi
  }>,
  ctx: AuthContext,
  input: { portalGroupId: string; portalId: string },
): Promise<{ gid: PortalGroupId; pid: PortalId; group: PortalGroup }> {
  if (!canForContext(ctx, 'portal.update')) {
    throw portalError('forbidden', 'this role cannot manage portal group membership')
  }

  const gid = portalGroupId(input.portalGroupId)
  const pid = portalId(input.portalId)

  const group = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
  if (!group) {
    throw portalError('group_not_found', 'portal group not found in this organization')
  }
  // Enforce property-assignment scoping (D6-001.)
  await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', group.propertyId)

  return { gid, pid, group }
}

/**
 * Create prologue: authorize portal.create, verify the referenced property
 * exists, and assert assignment access to it (D6-001). Returns the branded
 * propertyId for the use case's subsequent build/persist steps.
 */
export async function assertNewPortalPropertyAccess(
  deps: Readonly<{
    propertyApi: PropertyPublicApi
    staffPublicApi: StaffPublicApi
  }>,
  ctx: AuthContext,
  rawPropertyId: string,
  forbiddenMessage: string,
): Promise<PropertyId> {
  if (!canForContext(ctx, 'portal.create')) {
    throw portalError('forbidden', forbiddenMessage)
  }

  const pid = propertyId(rawPropertyId)
  if (!(await deps.propertyApi.propertyExists(ctx.organizationId, pid))) {
    throw portalError('property_not_found', 'property not found in this organization')
  }
  // Enforce property-assignment scoping for PropertyManager (AccountAdmin
  // bypasses via getAccessiblePropertyIds returning null). (D6-001.)
  await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.create', pid)

  return pid
}
