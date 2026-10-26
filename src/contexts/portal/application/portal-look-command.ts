// Portal context — what every save of a Portal's own look asks first, and how
// it answers (ADR 0070). The three saves (colours, name and logo, photo) share
// one prologue so who may change a Portal's look cannot drift between them.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, propertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../domain/errors'
import { PORTAL_LOOK_EDIT_PERMISSION, type PortalLookChange } from '../domain/portal-look'
import type { Portal } from '../domain/types'
import { assertPropertyAccess } from './assert-property-access'
import type { PortalLookSaved } from './dto/portal-look.dto'
import { loadPortalOrThrow } from './load-accessible-portal'
import { portalLookSavedOf } from './portal-look-view'
import type { PortalLookRepository } from './ports/portal-look.repository'
import type { PortalRepository } from './ports/portal.repository'

export type PortalLookCommandDeps = Readonly<{
  portalRepo: PortalRepository
  portalLookRepo: Pick<PortalLookRepository, 'savePortalLookPart'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
  /** PORTAL_OWN_LOOK_ENABLED: off, every save is refused. */
  portalOwnLookEnabled: boolean
}>

/** Which Portal a save names, and the Property the caller believes it is in. */
export type PortalLookTarget = Readonly<{ propertyId: string; portalId: string }>

/**
 * The Portal whose look may be changed: one the caller may update, not
 * archived, changed by an Account Admin of its Property, in the Property the
 * request names, and only while Portals may have a look of their own.
 */
export async function loadPortalForOwnLook(
  deps: Pick<
    PortalLookCommandDeps,
    'portalRepo' | 'staffPublicApi' | 'portalOwnLookEnabled'
  >,
  ctx: AuthContext,
  target: PortalLookTarget,
): Promise<Portal> {
  const portal = await loadPortalOrThrow(deps, ctx, portalId(target.portalId), {
    permission: 'portal.update',
    forbiddenMessage: 'This role cannot change this portal',
  })
  // Checked again under the Portal's row lock when the save is made.
  if (portal.publicationState === 'archived') {
    throw portalError('portal_inactive', 'Restore this portal before changing its look')
  }
  if (!canForContext(ctx, PORTAL_LOOK_EDIT_PERMISSION)) {
    throw portalError('forbidden', 'Only an account admin can change a portal’s look')
  }
  const pid = propertyId(target.propertyId)
  await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
  if (portal.propertyId !== pid) {
    throw portalError('portal_not_found', 'Portal not found for this Property')
  }
  if (!deps.portalOwnLookEnabled) {
    throw portalError('feature_unavailable', 'A portal cannot have its own look yet')
  }
  return portal
}

/** Save one group of the Portal's look and say where its groups now come from. */
export async function savePortalLookChange(
  deps: Pick<PortalLookCommandDeps, 'portalLookRepo' | 'clock'>,
  ctx: AuthContext,
  portal: Portal,
  change: PortalLookChange,
): Promise<PortalLookSaved> {
  const result = await deps.portalLookRepo.savePortalLookPart({
    organizationId: ctx.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.id,
    change,
    actorUserId: ctx.userId,
    at: deps.clock(),
  })
  switch (result.status) {
    case 'brand_profile_missing':
      throw portalError(
        'brand_profile_missing',
        'Set the public display name before changing the look',
      )
    case 'portal_not_found':
      throw portalError('portal_not_found', 'Portal not found for this Property')
    case 'portal_archived':
      throw portalError('portal_inactive', 'Restore this portal before changing its look')
    case 'saved':
      return portalLookSavedOf(portal.id, result.override, result.changedFacets)
  }
}
