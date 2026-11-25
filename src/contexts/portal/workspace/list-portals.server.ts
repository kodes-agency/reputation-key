// Portal context — list portals use case

import type { PortalRepository } from '../publication/portal-repository.port.server'
import type { Portal } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import type { StaffPublicApi } from '#/contexts/identity/public-api'

export type ListPortalsInput = Readonly<{
  propertyId?: string
}>

export type ListPortalsDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
}>

/**
 * The Portals the caller may read, for one Property or the whole organization.
 * Scoped to the Properties in the caller's staff assignment; an
 * organization-wide role sees all of them (the lookup answers null).
 */
export const listAccessiblePortals = async (
  deps: Readonly<{
    portalRepo: Pick<PortalRepository, 'list' | 'listByProperty'>
    staffPublicApi: StaffPublicApi
  }>,
  scope: Readonly<{ propertyId?: string }>,
  ctx: AuthContext,
): Promise<ReadonlyArray<Portal>> => {
  if (!canForContext(ctx, 'portal.read')) {
    throw portalError('forbidden', 'No portal read permission')
  }
  // D6-001: scope reads to properties in the caller's staff_assignment.
  const accessible = await getAccessiblePropertyIdsForPermission(
    (orgId, userId, orgWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx,
    'portal.read',
  )
  const results =
    scope.propertyId !== undefined
      ? await deps.portalRepo.listByProperty(ctx.organizationId, scope.propertyId)
      : await deps.portalRepo.list(ctx.organizationId)
  if (accessible === null) {
    return results
  }
  return results.filter((p) => accessible.includes(p.propertyId))
}

export const listPortals =
  (deps: ListPortalsDeps) =>
  (input: ListPortalsInput, ctx: AuthContext): Promise<ReadonlyArray<Portal>> =>
    listAccessiblePortals(deps, { propertyId: input.propertyId || undefined }, ctx)

export type ListPortals = ReturnType<typeof listPortals>
