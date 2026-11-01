import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { portalError } from '../../domain/errors'
import { updatePortal, type UpdatePortalDeps } from './update-portal'

export const archivePersonalPortal =
  (deps: UpdatePortalDeps, memberDeparture = false) =>
  async (input: Readonly<{ portalId: string }>, ctx: AuthContext) => {
    const portal = memberDeparture
      ? await deps.portalRepo.findById(ctx.organizationId, portalId(input.portalId))
      : await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
          permission: 'staff.remove',
          forbiddenMessage: 'This account cannot remove staff',
        })
    if (!portal)
      throw portalError('portal_not_found', 'Portal not found in this Organization')
    if (portal.kind !== 'personal')
      throw portalError(
        'forbidden',
        'Only a personal Portal can be removed through Staff',
      )
    if (portal.publicationState === 'archived') return portal
    return updatePortal({
      ...deps,
      personalArchive: true,
      memberDepartureArchive: memberDeparture,
    })({ ...input, publicationState: 'archived' }, ctx)
  }
