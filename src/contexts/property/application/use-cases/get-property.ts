// Property context — get single property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'

// fallow-ignore-next-line unused-type
export type GetPropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  staffPublicApi: StaffPublicApi
}>

// fallow-ignore-next-line unused-type
export type GetPropertyInput = Readonly<{
  propertyId: string
}>

export const getProperty =
  (deps: GetPropertyDeps) =>
  async (input: GetPropertyInput, ctx: AuthContext): Promise<Property> => {
    if (!canForContext(ctx, 'property.read')) {
      throw propertyError('forbidden', 'No property read permission')
    }
    const pid = propertyId(input.propertyId)
    const property = await deps.propertyRepo.findById(ctx.organizationId, pid)
    if (!property) {
      throw propertyError('property_not_found', 'property not found')
    }

    // Enforce property-assignment scoping for PropertyManager (AccountAdmin
    // bypasses via getAccessiblePropertyIds returning null). Mirrors the
    // update-property write path. (PROPERTY-001 / D6-001.)
    const accessible = await isPropertyAccessibleForPermission(
      (orgId, userId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
      ctx,
      'property.read',
      pid,
    )
    if (!accessible) {
      throw propertyError('forbidden', 'No access to this property', { propertyId: pid })
    }
    return property
  }

// fallow-ignore-next-line unused-type
export type GetProperty = ReturnType<typeof getProperty>
