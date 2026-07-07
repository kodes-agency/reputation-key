// Portal context — list portals use case

import type { PortalRepository } from '../ports/portal.repository'
import type { Portal } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

// fallow-ignore-next-line unused-type
export type ListPortalsInput = Readonly<{
  propertyId?: string
}>

// fallow-ignore-next-line unused-type
export type ListPortalsDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
}>

export const listPortals =
  (deps: ListPortalsDeps) =>
  async (input: ListPortalsInput, ctx: AuthContext): Promise<ReadonlyArray<Portal>> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    // D6-001: scope reads to properties in the caller's staff_assignment.
    // AccountAdmin bypasses (getAccessiblePropertyIds returns null).
    const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
      ctx.organizationId,
      ctx.userId,
      ctx.role === 'AccountAdmin',
    )
    const results = input.propertyId
      ? await deps.portalRepo.listByProperty(ctx.organizationId, input.propertyId)
      : await deps.portalRepo.list(ctx.organizationId)
    if (accessible === null) {
      return results
    }
    return results.filter((p) => accessible.includes(p.propertyId))
  }

// fallow-ignore-next-line unused-type
export type ListPortals = ReturnType<typeof listPortals>
