// Property context — get single property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { Property, PropertyId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyError } from '../../domain/errors'

export type GetPropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
}>

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
      input.propertyId as PropertyId,
    )
    if (!property) {
      throw propertyError('property_not_found', 'property not found')
    }
    return property
  }

export type GetProperty = ReturnType<typeof getProperty>
