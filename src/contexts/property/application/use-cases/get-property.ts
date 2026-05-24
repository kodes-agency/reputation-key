// Property context — get single property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'

// fallow-ignore-next-line unused-type
export type GetPropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
}>

// fallow-ignore-next-line unused-type
export type GetPropertyInput = Readonly<{
  propertyId: string
}>

export const getProperty =
  (deps: GetPropertyDeps) =>
  async (input: GetPropertyInput, ctx: AuthContext): Promise<Property> => {
    if (!can(ctx.role, 'property.read')) {
      throw propertyError('forbidden', 'No property read permission')
    }
    const property = await deps.propertyRepo.findById(
      ctx.organizationId,
      propertyId(input.propertyId),
    )
    if (!property) {
      throw propertyError('property_not_found', 'property not found')
    }
    return property
  }

// fallow-ignore-next-line unused-type
export type GetProperty = ReturnType<typeof getProperty>
