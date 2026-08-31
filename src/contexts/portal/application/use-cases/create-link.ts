// Portal context — create link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLink } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { buildPortalLink } from '../../domain/constructors'
import { generateKeyBetween } from 'fractional-indexing'
import { portalLinkCreated } from '../../domain/events'
import { portalId, portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'

import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'
import { canForContext } from '#/shared/domain/permissions'
import type { PortalApprovedDestinationRepository } from '../ports/portal-approved-destination.repository'
import { resolveApprovedPortalDestination } from '../resolve-approved-portal-destination'
import type { PortalDestinationNetworkValidator } from '../ports/portal-destination-network-validator.port'

export type CreateLinkInput = Readonly<{
  categoryId: string
  portalId: string
  label: string
  url: string
  iconKey?: string
}>

export type CreateLinkDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'request'>
  destinationNetworkValidator: PortalDestinationNetworkValidator
  idGen: () => string
  clock: () => Date
}>

export const createLink =
  (deps: CreateLinkDeps) =>
  async (input: CreateLinkInput, ctx: AuthContext): Promise<PortalLink> => {
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'Insufficient permissions to create portal links')
    }
    const category = await deps.portalLinkRepo.findCategoryById(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
    if (!category) {
      throw portalError('category_not_found', 'category not found')
    }
    if (category.portalId !== portalId(input.portalId)) {
      throw portalError('forbidden', 'Category does not belong to this portal')
    }
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to create portal links',
    })

    const destination = await resolveApprovedPortalDestination(
      deps,
      { uri: input.url, propertyId: portal.propertyId },
      ctx,
    )

    const existing = await deps.portalLinkRepo.listLinks(
      ctx.organizationId,
      portalId(input.portalId),
      portalLinkCategoryId(input.categoryId),
    )
    const lastSortKey = existing.length > 0 ? existing[existing.length - 1].sortKey : null
    const sortKey = generateKeyBetween(lastSortKey, null)

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
    const result = buildPortalLink({
      id: portalLinkId(deps.idGen()),
      categoryId: portalLinkCategoryId(input.categoryId),
      portalId: portalId(input.portalId),
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      destinationId: destination.id,
      legacyDestinationState: 'migrated',
      label: input.label,
      url: destination.normalizedUri,
      iconKey: input.iconKey,
      sortKey,
      now: occurredAt,
    })

    if (result.isErr()) throw result.error

    const event = portalLinkCreated({
      portalId: portalId(input.portalId),
      linkId: result.value.id,
      categoryId: portalLinkCategoryId(input.categoryId),
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt,
    })
    await deps.commandStore.createPortalLink({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      link: result.value,
      revision,
      occurredAt,
      event,
    })

    return result.value
  }

export type CreateLink = ReturnType<typeof createLink>
