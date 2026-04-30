// Portal context — reorder links use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalLinkReordered } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalId, portalLinkId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type ReorderLinksDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
  events: EventBus
  clock: () => Date
}>

export const reorderLinks =
  (deps: ReorderLinksDeps) =>
  async (
    input: {
      categoryId: string
      portalId: string
      items: ReadonlyArray<{ id: string; sortKey: string }>
    },
    ctx: AuthContext,
  ): Promise<void> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot reorder portal links')
    }

    await deps.portalLinkRepo.reorderLinks(
      ctx.organizationId,
      input.items.map((item) => ({ id: portalLinkId(item.id), sortKey: item.sortKey })),
    )

    deps.events.emit(
      portalLinkReordered({
        portalId: portalId(input.portalId),
        categoryId: input.categoryId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type ReorderLinks = ReturnType<typeof reorderLinks>
