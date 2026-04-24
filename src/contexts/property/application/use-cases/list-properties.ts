// Property context — list properties use case
// Thin: no authorization check needed — all authenticated roles can list properties
// in their own organization. Tenant isolation is enforced by the repository.

import type { PropertyRepository } from '../ports/property.repository'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'

export type ListPropertiesDeps = Readonly<{
  propertyRepo: PropertyRepository
}>

export const listProperties =
  (deps: ListPropertiesDeps) =>
  async (ctx: AuthContext): Promise<ReadonlyArray<Property>> => {
    return deps.propertyRepo.list(ctx.organizationId)
  }

export type ListProperties = ReturnType<typeof listProperties>
