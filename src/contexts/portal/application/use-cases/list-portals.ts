// Portal context — list portals use case

import type { PortalRepository } from '../ports/portal.repository'
import type { Portal } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'

// fallow-ignore-next-line unused-type
export type ListPortalsDeps = Readonly<{
  portalRepo: PortalRepository
}>

export const listPortals =
  (deps: ListPortalsDeps) =>
  async (
    input: { propertyId?: string },
    ctx: AuthContext,
  ): Promise<ReadonlyArray<Portal>> => {
    if (input.propertyId) {
      return deps.portalRepo.listByProperty(ctx.organizationId, input.propertyId)
    }
    return deps.portalRepo.list(ctx.organizationId)
  }

// fallow-ignore-next-line unused-type
export type ListPortals = ReturnType<typeof listPortals>
