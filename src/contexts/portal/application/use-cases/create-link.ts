// Portal context — create link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { Portal, PortalLink, PortalLinkCategory } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { validateLinkIconKey, validateLinkLabel } from '../../domain/rules'
import { buildPortalLink, buildPortalLinkCategory } from '../../domain/constructors'
import { hasRoomForAnotherLink, startedCategoryTitle } from '../../domain/portal-linktree'
import { generateKeyBetween } from 'fractional-indexing'
import { portalLinkCategoryCreated, portalLinkCreated } from '../../domain/events'
import { portalId, portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'
import type { GuestLocale } from '#/shared/domain/guest-locale'

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type {
  CreatePortalLinkCommand,
  PortalCommandStore,
} from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'
import { canForContext } from '#/shared/domain/permissions'
import type { PortalApprovedDestinationRepository } from '../ports/portal-approved-destination.repository'
import { resolveApprovedPortalDestination } from '../resolve-approved-portal-destination'
import type { PortalDestinationNetworkValidator } from '../ports/portal-destination-network-validator.port'

export type CreateLinkInput = Readonly<{
  /**
   * Left out by the Linktree editor, which no longer shows categories: the link
   * then joins the Portal's last category, and the first link starts one.
   */
  categoryId?: string
  portalId: string
  label: string
  url: string
  iconKey?: string
}>

export type CreateLinkDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  /** Read for the title the Portal's first category starts with. */
  experienceRepo: Pick<PortalExperienceRepository, 'listPortalOverrides'>
  commandStore: PortalCommandStore
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'request'>
  destinationNetworkValidator: PortalDestinationNetworkValidator
  idGen: () => string
  clock: () => Date
}>

async function loadRequestedCategory(
  deps: CreateLinkDeps,
  ctx: AuthContext,
  categoryId: string,
  portalIdInput: string,
): Promise<PortalLinkCategory> {
  const category = await deps.portalLinkRepo.findCategoryById(
    ctx.organizationId,
    portalLinkCategoryId(categoryId),
  )
  if (!category) {
    throw portalError('category_not_found', 'category not found')
  }
  if (category.portalId !== portalId(portalIdInput)) {
    throw portalError('forbidden', 'Category does not belong to this portal')
  }
  return category
}

type StartedCategory = NonNullable<CreatePortalLinkCommand['startCategory']>

/**
 * The Portal's last category; when it has none, a new one, handed to the link
 * write to be committed with the link, never on its own. Titled in the Portal's
 * primary language, because the legacy guest page prints it.
 */
async function lastOrStartedCategory(
  deps: CreateLinkDeps,
  ctx: AuthContext,
  portal: Portal,
  at: Readonly<{ occurredAt: Date; revision: Date }>,
): Promise<
  Readonly<{ category: PortalLinkCategory; started: StartedCategory | undefined }>
> {
  const existing = await deps.portalLinkRepo.listCategories(ctx.organizationId, portal.id)
  const last = existing[existing.length - 1]
  if (last) return { category: last, started: undefined }

  const overrides = await deps.experienceRepo.listPortalOverrides(
    ctx.organizationId,
    portal.propertyId,
    portal.id,
  )
  const titles: Partial<Record<GuestLocale, string>> = {}
  for (const entry of overrides) {
    if (entry.linktreeTitle !== null) titles[entry.locale] = entry.linktreeTitle
  }
  const built = buildPortalLinkCategory({
    id: portalLinkCategoryId(deps.idGen()),
    portalId: portal.id,
    organizationId: ctx.organizationId,
    title: startedCategoryTitle(portal.primaryGuestLocale, titles),
    sortKey: generateKeyBetween(null, null),
    now: at.occurredAt,
  })
  if (built.isErr()) throw built.error
  const event = portalLinkCategoryCreated({
    portalId: portal.id,
    categoryId: built.value.id,
    organizationId: ctx.organizationId,
    propertyId: portal.propertyId,
    sourceAggregateVersion: at.revision.toISOString(),
    occurredAt: at.occurredAt,
  })
  return { category: built.value, started: { category: built.value, event } }
}

export const createLink =
  (deps: CreateLinkDeps) =>
  async (input: CreateLinkInput, ctx: AuthContext): Promise<PortalLink> => {
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'Insufficient permissions to create portal links')
    }
    const requested =
      input.categoryId === undefined
        ? null
        : await loadRequestedCategory(deps, ctx, input.categoryId, input.portalId)
    const loaded = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to create portal links',
    })

    // Checked before the destination is requested, which is a write of its own.
    // The command store checks again under the Portal lock; this one only spares
    // a pointless destination request and gives the manager the answer early.
    const linksOfPortal = await deps.portalLinkRepo.listAllLinks(
      ctx.organizationId,
      portalId(input.portalId),
    )
    if (!hasRoomForAnotherLink(linksOfPortal.length)) {
      throw portalError('link_limit_reached', 'A Portal can carry at most four links')
    }

    // What a link must say for itself is checked before anything is written, so
    // a refused link cannot leave a category behind.
    for (const check of [
      validateLinkLabel(input.label),
      validateLinkIconKey(input.iconKey),
    ]) {
      if (check.isErr()) throw check.error
    }

    const destination = await resolveApprovedPortalDestination(
      deps,
      { uri: input.url, propertyId: loaded.propertyId },
      ctx,
    )

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, loaded.updatedAt)
    const { category, started } = requested
      ? { category: requested, started: undefined }
      : await lastOrStartedCategory(deps, ctx, loaded, { occurredAt, revision })
    const portal = loaded
    const existing = await deps.portalLinkRepo.listLinks(
      ctx.organizationId,
      portalId(input.portalId),
      category.id,
    )
    const lastSortKey = existing.length > 0 ? existing[existing.length - 1].sortKey : null
    const sortKey = generateKeyBetween(lastSortKey, null)

    const result = buildPortalLink({
      id: portalLinkId(deps.idGen()),
      categoryId: category.id,
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
      categoryId: category.id,
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
      actorUserId: ctx.userId,
      link: result.value,
      revision,
      occurredAt,
      event,
      ...(started ? { startCategory: started } : {}),
    })

    return result.value
  }

export type CreateLink = ReturnType<typeof createLink>
