// Property context — get single property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'

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
    // Note: no role-based authorization check (step 1) — all authenticated
    // users within an organization can view properties. Tenant isolation is
    // enforced by the repository filtering by ctx.organizationId.
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
