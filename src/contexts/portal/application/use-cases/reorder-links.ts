// Portal context — reorder links use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalLinkReordered } from '../../domain/events'
import { portalId, portalLinkId, portalLinkCategoryId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type ReorderLinksInput = Readonly<{
  categoryId: string
  portalId: string
  items: ReadonlyArray<{ id: string; sortKey: string }>
}>

export type ReorderLinksDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const reorderLinks =
  (deps: ReorderLinksDeps) =>
  async (input: ReorderLinksInput, ctx: AuthContext): Promise<void> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'this role cannot reorder portal links',
    })
    const now = nextPortalCommandAt(deps.clock(), portal.updatedAt)
    const categoryId = portalLinkCategoryId(input.categoryId)
    const updates = input.items.map((item) => ({
      id: portalLinkId(item.id),
      sortKey: item.sortKey,
    }))
    const event = portalLinkReordered({
      portalId: portal.id,
      categoryId,
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: now.toISOString(),
      occurredAt: now,
    })
    await deps.commandStore.reorderPortalLinks({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      categoryId,
      updates,
      at: now,
      event,
    })
  }

export type ReorderLinks = ReturnType<typeof reorderLinks>
