// Portal context — reorder categories use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalLinkCategoryReordered } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalId, portalLinkCategoryId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type ReorderCategoriesDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
  events: EventBus
  clock: () => Date
}>

export const reorderCategories =
  (deps: ReorderCategoriesDeps) =>
  async (
    input: { portalId: string; items: ReadonlyArray<{ id: string; sortKey: string }> },
    ctx: AuthContext,
  ): Promise<void> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot reorder portal categories')
    }

    await deps.portalLinkRepo.reorderCategories(
      ctx.organizationId,
      input.items.map((item) => ({ id: portalLinkCategoryId(item.id), sortKey: item.sortKey })),
    )

    deps.events.emit(
      portalLinkCategoryReordered({
        portalId: portalId(input.portalId),
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type ReorderCategories = ReturnType<typeof reorderCategories>
