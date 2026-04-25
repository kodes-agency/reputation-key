// Property context — list properties use case
// Uses PropertyAccessProvider to filter by user assignment.
// AccountAdmin sees all properties; PropertyManager/Staff see only assigned.

import type { PropertyRepository } from '../ports/property.repository'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyAccessProvider } from '#/shared/domain/property-access.port'

export type ListPropertiesDeps = Readonly<{
  propertyRepo: PropertyRepository
  propertyAccess: PropertyAccessProvider
}>

export const listProperties =
  (deps: ListPropertiesDeps) =>
  async (ctx: AuthContext): Promise<ReadonlyArray<Property>> => {
    const accessibleIds = await deps.propertyAccess.getAccessiblePropertyIds(
      ctx.organizationId,
      ctx.userId,
      ctx.role,
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

export type ListProperties = ReturnType<typeof listProperties>
