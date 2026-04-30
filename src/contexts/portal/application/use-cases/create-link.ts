// Portal context — create link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLink } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { buildPortalLink } from '../../domain/constructors'
import { generateKeyBetween } from 'fractional-indexing'
import { portalLinkCreated } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalId, portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type CreateLinkDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
  events: EventBus
  idGen: () => string
  clock: () => Date
}>

export const createLink =
  (deps: CreateLinkDeps) =>
  async (
    input: {
      categoryId: string
      portalId: string
      label: string
      url: string
      iconKey?: string
    },
    ctx: AuthContext,
  ): Promise<PortalLink> => {
    const category = await deps.portalLinkRepo.findCategoryById(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
    if (!category) {
      throw portalError('category_not_found', 'category not found')
    }

    const existing = await deps.portalLinkRepo.listLinks(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
    const lastSortKey = existing.length > 0 ? existing[existing.length - 1].sortKey : null
    const sortKey = generateKeyBetween(lastSortKey, null)

    const result = buildPortalLink({
      id: portalLinkId(deps.idGen()),
      categoryId: portalLinkCategoryId(input.categoryId),
      portalId: portalId(input.portalId),
      organizationId: ctx.organizationId,
      label: input.label,
      url: input.url,
      iconKey: input.iconKey,
      sortKey,
      now: deps.clock(),
    })

    if (result.isErr()) throw result.error

    await deps.portalLinkRepo.insertLink(ctx.organizationId, result.value)

    deps.events.emit(
      portalLinkCreated({
        portalId: portalId(input.portalId),
        linkId: result.value.id,
        categoryId: input.categoryId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )

    return result.value
  }

// fallow-ignore-next-line unused-type
export type CreateLink = ReturnType<typeof createLink>
