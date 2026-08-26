// Portal context — create link category use case

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLinkCategory } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { buildPortalLinkCategory } from '../../domain/constructors'
import { generateKeyBetween } from 'fractional-indexing'
import { portalLinkCategoryCreated } from '../../domain/events'
import { portalId, portalLinkCategoryId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type CreateLinkCategoryInput = Readonly<{
  portalId: string
  title: string
}>

export type CreateLinkCategoryDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  idGen: () => string
  clock: () => Date
}>

export const createLinkCategory =
  (deps: CreateLinkCategoryDeps) =>
  async (
    input: CreateLinkCategoryInput,
    ctx: AuthContext,
  ): Promise<PortalLinkCategory> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to create link categories',
    })

    const existing = await deps.portalLinkRepo.listCategories(
      ctx.organizationId,
      portal.id,
    )
    const lastSortKey = existing.length > 0 ? existing[existing.length - 1].sortKey : null
    const sortKey = generateKeyBetween(lastSortKey, null)

    const now = nextPortalCommandAt(deps.clock(), portal.updatedAt)
    const result = buildPortalLinkCategory({
      id: portalLinkCategoryId(deps.idGen()),
      portalId: portalId(input.portalId),
      organizationId: ctx.organizationId,
      title: input.title,
      sortKey,
      now,
    })

    if (result.isErr()) throw result.error

    const event = portalLinkCategoryCreated({
      portalId: portal.id,
      categoryId: result.value.id,
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: now.toISOString(),
      occurredAt: now,
    })
    await deps.commandStore.createPortalLinkCategory({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      category: result.value,
      at: now,
      event,
    })

    return result.value
  }

export type CreateLinkCategory = ReturnType<typeof createLinkCategory>
