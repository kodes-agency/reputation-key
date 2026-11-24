// Property context — load a Property the actor may use for one permission

import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import { canForContext, type Permission } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { propertyError } from '../domain/errors'
import type { PropertyRepository } from './property-repository.port.server'

export type LoadAccessiblePropertyDeps = Readonly<{
  propertyRepo: Pick<PropertyRepository, 'findById'>
  staffPublicApi: Pick<StaffPublicApi, 'getAccessiblePropertyIds'>
}>

/**
 * Role check, lookup in the actor's organization, then the assigned-Property
 * grant check, in that order. `roleDeniedMessage` names what the role may not do.
 */
export const loadAccessibleProperty = async (
  deps: LoadAccessiblePropertyDeps,
  rawPropertyId: string,
  ctx: AuthContext,
  permission: Permission,
  roleDeniedMessage: string,
) => {
  if (!canForContext(ctx, permission)) {
    throw propertyError('forbidden', roleDeniedMessage)
  }
  const pid = toPropertyId(rawPropertyId)
  const property = await deps.propertyRepo.findById(ctx.organizationId, pid)
  if (!property) throw propertyError('property_not_found', 'property not found')
  const accessible = await isPropertyAccessibleForPermission(
    (organizationId, userId, organizationWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(
        organizationId,
        userId,
        organizationWide,
      ),
    ctx,
    permission,
    pid,
  )
  if (!accessible) {
    throw propertyError('forbidden', 'No access to this property', { propertyId: pid })
  }
  return property
}
