// Portal context — update link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLink } from '../../domain/types'
import {
  type OrganizationId,
  type PortalMediaAssetId,
  type PropertyId,
} from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { findReferencableMediaAsset } from '../referencable-media-asset'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { validateLinkIconKey, validateLinkLabel } from '../../domain/rules'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { authorizeLinkCommand } from '../authorize-link-command'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'
import { portalLinkUpdated } from '../../domain/events'
import type { PortalApprovedDestinationRepository } from '../ports/portal-approved-destination.repository'
import { resolveApprovedPortalDestination } from '../resolve-approved-portal-destination'
import type { PortalDestinationNetworkValidator } from '../ports/portal-destination-network-validator.port'

export type UpdateLinkInput = Readonly<{
  linkId: string
  label?: string
  url?: string
  iconKey?: string | null
  /** An uploaded picture for the tile, or null to take it off; left out, it stays. */
  imageAssetId?: string | null
}>

export type UpdateLinkDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'request'>
  destinationNetworkValidator: PortalDestinationNetworkValidator
  idGen: () => string
  clock: () => Date
}>

/**
 * The asset a link may point at: a picture uploaded for a link tile, of this
 * Organization and this Property, that may still be served. Anything else is the
 * same refusal as a missing image, so a probe learns nothing about other tenants.
 */
async function resolveTileImage(
  deps: Pick<UpdateLinkDeps, 'mediaRepo'>,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  assetId: string,
): Promise<PortalMediaAssetId> {
  const asset = await findReferencableMediaAsset(
    deps.mediaRepo,
    organizationId,
    propertyId,
    'link_image',
    assetId,
  )
  if (!asset) throw portalError('media_not_found', 'image not found for this link')
  return asset.id
}

/**
 * Updates a link. The returned link's `label` is the new name when this call
 * renamed it; otherwise it is whatever the legacy column holds (`''` for a link
 * written after round 4's contract), NOT the link's name, which is its
 * primary-language text. Callers that need the name read the Linktree.
 */
export const updateLink =
  (deps: UpdateLinkDeps) =>
  async (input: UpdateLinkInput, ctx: AuthContext): Promise<PortalLink> => {
    // 1. Authorize, including property-assignment scoping (D6-001.)
    const { target, portal } = await authorizeLinkCommand(deps, ctx, input.linkId)
    const existing = target.link

    let validatedLabel: string | undefined
    let needsUpdate = false

    if (input.label !== undefined) {
      const r = validateLinkLabel(input.label)
      if (r.isErr()) throw r.error
      validatedLabel = r.value
      needsUpdate = true
    }

    const destination =
      input.url === undefined
        ? null
        : await resolveApprovedPortalDestination(
            deps,
            { uri: input.url, propertyId: portal.propertyId },
            ctx,
          )
    if (destination) needsUpdate = true

    if (input.iconKey !== undefined) {
      const r = validateLinkIconKey(input.iconKey)
      if (r.isErr()) throw r.error
      needsUpdate = true
    }

    let imageAssetId = existing.imageAssetId
    if (input.imageAssetId !== undefined) {
      imageAssetId =
        input.imageAssetId === null
          ? null
          : await resolveTileImage(
              deps,
              ctx.organizationId,
              portal.propertyId,
              input.imageAssetId,
            )
      needsUpdate = true
    }

    if (!needsUpdate) return existing

    const expectedPortalUpdatedAt = target.portalUpdatedAt ?? portal.updatedAt
    const newUrl = destination?.normalizedUri ?? existing.url
    const destinationId = destination?.id ?? existing.destinationId
    const newIconKey = input.iconKey !== undefined ? input.iconKey : existing.iconKey

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, expectedPortalUpdatedAt)
    await deps.commandStore.updatePortalLink({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: existing.portalId,
      expectedPortalUpdatedAt,
      revision,
      occurredAt,
      actorUserId: ctx.userId,
      linkId: existing.id,
      categoryId: existing.categoryId,
      patch: {
        // Only a rename carries a label: the primary-language text is the link's
        // name, and the stored legacy label is no longer the source of it.
        ...(validatedLabel === undefined ? {} : { label: validatedLabel }),
        url: newUrl,
        destinationId,
        legacyDestinationState: destination
          ? 'migrated'
          : existing.legacyDestinationState,
        iconKey: newIconKey,
        imageAssetId,
      },
      event: portalLinkUpdated({
        portalId: existing.portalId,
        linkId: existing.id,
        categoryId: existing.categoryId,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })

    return {
      ...existing,
      ...(validatedLabel === undefined ? {} : { label: validatedLabel }),
      url: newUrl,
      destinationId,
      legacyDestinationState: destination ? 'migrated' : existing.legacyDestinationState,
      iconKey: newIconKey,
      imageAssetId,
      updatedAt: occurredAt,
    }
  }

export type UpdateLink = ReturnType<typeof updateLink>
