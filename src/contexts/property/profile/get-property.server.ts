// Property context — get single property use case

import type { PropertyRepository } from './property-repository.port.server'
import { loadAccessibleProperty } from './load-accessible-property.server'
import type { Property } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/public-api'

export type GetPropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  staffPublicApi: StaffPublicApi
}>

export type GetPropertyInput = Readonly<{
  propertyId: string
}>

export const getProperty =
  (deps: GetPropertyDeps) =>
  async (input: GetPropertyInput, ctx: AuthContext): Promise<Property> => {
    return loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.read',
      'No property read permission',
    )
  }

export type GetProperty = ReturnType<typeof getProperty>
