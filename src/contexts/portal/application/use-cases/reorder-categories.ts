// Portal context — reorder categories use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalLinkCategoryReordered } from '../../domain/events'
import { portalId, portalLinkCategoryId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type ReorderCategoriesInput = Readonly<{
  portalId: string
  items: ReadonlyArray<{ id: string; sortKey: string }>
}>

export type ReorderCategoriesDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const reorderCategories =
  (deps: ReorderCategoriesDeps) =>
  async (input: ReorderCategoriesInput, ctx: AuthContext): Promise<void> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'this role cannot reorder portal categories',
    })
    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
    const updates = input.items.map((item) => ({
      id: portalLinkCategoryId(item.id),
      sortKey: item.sortKey,
    }))
    const event = portalLinkCategoryReordered({
      portalId: portal.id,
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt,
    })
    await deps.commandStore.reorderPortalLinkCategories({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      updates,
      revision,
      occurredAt,
      event,
    })
  }

export type ReorderCategories = ReturnType<typeof reorderCategories>
