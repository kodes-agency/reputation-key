// Portal context — create link category use case

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLinkCategory } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { buildPortalLinkCategory } from '../../domain/constructors'
import { generateKeyBetween } from 'fractional-indexing'
import { portalLinkCategoryCreated } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalId, portalLinkCategoryId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type CreateLinkCategoryInput = Readonly<{
  portalId: string
  title: string
}>

export type CreateLinkCategoryDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  idGen: () => string
  clock: () => Date
  outboxRepo?: OutboxRepository
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

    const result = buildPortalLinkCategory({
      id: portalLinkCategoryId(deps.idGen()),
      portalId: portalId(input.portalId),
      organizationId: ctx.organizationId,
      title: input.title,
      sortKey,
      now: deps.clock(),
    })

    if (result.isErr()) throw result.error

    await deps.portalLinkRepo.insertCategory(ctx.organizationId, result.value)

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalLinkCategoryCreated({
        portalId: portal.id,
        categoryId: result.value.id,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )

    return result.value
  }

export type CreateLinkCategory = ReturnType<typeof createLinkCategory>
