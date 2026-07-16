// Portal context — reorder links use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalLinkReordered } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalId, portalLinkId, portalLinkCategoryId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

// fallow-ignore-next-line unused-type
export type ReorderLinksInput = Readonly<{
  categoryId: string
  portalId: string
  items: ReadonlyArray<{ id: string; sortKey: string }>
}>

// fallow-ignore-next-line unused-type
export type ReorderLinksDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export const reorderLinks =
  (deps: ReorderLinksDeps) =>
  async (input: ReorderLinksInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot reorder portal links')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      'portal.update',
      portalId(input.portalId),
    )

    await deps.portalLinkRepo.reorderLinks(
      ctx.organizationId,
      input.items.map((item) => ({ id: portalLinkId(item.id), sortKey: item.sortKey })),
    )

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalLinkReordered({
        portalId: portalId(input.portalId),
        categoryId: portalLinkCategoryId(input.categoryId),
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type ReorderLinks = ReturnType<typeof reorderLinks>
