// Portal context — read the Linktree section for the editor.
//
// One read for the whole section: the switch, the titles a manager wrote, and
// every link in guest order with its per-language texts, its icon and whether
// the place it opens is approved. Read-only, gated by `portal.read`.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import {
  buildPortalLinktreeView,
  type PortalLinktreeView,
} from '../domain/portal-linktree-view'
import { listServableTileImageIds } from '../media/servable-tile-images.server'
import { loadPortalOrThrow } from '../publication/load-accessible-portal.server'
import type { PortalApprovedDestinationRepository } from '../destinations/portal-approved-destination-repository.port.server'
import type { PortalMediaAssetRepository } from '../media/portal-media-asset-repository.port.server'
import type { PortalExperienceRepository } from '../editor/portal-experience-repository.port.server'
import type { PortalLinkRepository } from './portal-link-repository.port.server'
import type { PortalRepository } from '../publication/portal-repository.port.server'

export type GetPortalLinktreeInput = Readonly<{ portalId: string }>

export type GetPortalLinktreeDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  experienceRepo: Pick<PortalExperienceRepository, 'listPortalOverrides'>
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'list'>
  /** Which tile pictures may still be served: a taken-down one is not shown as the tile's photo. */
  mediaRepo: Pick<PortalMediaAssetRepository, 'listServableIds'>
  staffPublicApi: StaffPublicApi
}>

export const getPortalLinktree =
  (deps: GetPortalLinktreeDeps) =>
  async (
    input: GetPortalLinktreeInput,
    ctx: AuthContext,
  ): Promise<PortalLinktreeView> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to read the Linktree',
    })
    const [categories, links, texts, overrides, destinations] = await Promise.all([
      deps.portalLinkRepo.listCategories(ctx.organizationId, portal.id),
      deps.portalLinkRepo.listAllLinks(ctx.organizationId, portal.id),
      deps.portalLinkRepo.listLinkTexts(
        ctx.organizationId,
        portal.id,
        portal.primaryGuestLocale,
      ),
      deps.experienceRepo.listPortalOverrides(
        ctx.organizationId,
        portal.propertyId,
        portal.id,
      ),
      deps.destinationRepo.list(ctx.organizationId, portal.propertyId),
    ])
    const servable = await listServableTileImageIds(
      deps.mediaRepo,
      ctx.organizationId,
      portal.propertyId,
      links,
    )
    return buildPortalLinktreeView({
      portal,
      categories,
      links,
      texts,
      titles: overrides,
      destinations,
      servableImageIds: servable,
    })
  }

export type GetPortalLinktree = ReturnType<typeof getPortalLinktree>
