// Property context — list properties use case
// Uses StaffPublicApi to filter by user assignment.
// AccountAdmin sees all properties; PropertyManager/Staff see only assigned.

import type { PropertyRepository } from '../ports/property.repository'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'

// fallow-ignore-next-line unused-type
export type ListPropertiesDeps = Readonly<{
  propertyRepo: PropertyRepository
  staffApi: StaffPublicApi
}>

export const listProperties =
  (deps: ListPropertiesDeps) =>
  async (ctx: AuthContext): Promise<ReadonlyArray<Property>> => {
    if (!canForContext(ctx, 'property.read')) {
      throw propertyError('forbidden', 'No property read permission')
    }
    const accessibleIds = await getAccessiblePropertyIdsForPermission(
      (orgId, userId, orgWide) =>
        deps.staffApi.getAccessiblePropertyIds(orgId, userId, orgWide),
      ctx,
      'property.read',
    )

    // null means "all properties" (AccountAdmin)
    if (accessibleIds === null) {
      return deps.propertyRepo.list(ctx.organizationId)
    }

    // Filter to only accessible properties
    const all = await deps.propertyRepo.list(ctx.organizationId)
    const idSet = new Set(accessibleIds)
    return all.filter((p) => idSet.has(p.id))
  }

// fallow-ignore-next-line unused-type
export type ListProperties = ReturnType<typeof listProperties>
