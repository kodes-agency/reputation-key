// Portal context — create link category use case

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLinkCategory } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { buildPortalLinkCategory } from '../../domain/constructors'
import { generateKeyBetween } from 'fractional-indexing'
import { portalLinkCategoryCreated } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalId, portalLinkCategoryId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type CreateLinkCategoryInput = Readonly<{
  portalId: string
  title: string
}>

// fallow-ignore-next-line unused-type
export type CreateLinkCategoryDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  idGen: () => string
  clock: () => Date
}>

export const createLinkCategory =
  (deps: CreateLinkCategoryDeps) =>
  async (
    input: CreateLinkCategoryInput,
    ctx: AuthContext,
  ): Promise<PortalLinkCategory> => {
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'Insufficient permissions to create link categories')
    }

    const portal = await deps.portalRepo.findById(
      ctx.organizationId,
      portalId(input.portalId),
    )
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(deps.staffPublicApi, ctx, portal.propertyId)

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

    await deps.events.emit(
      portalLinkCategoryCreated({
        portalId: portal.id,
        categoryId: result.value.id,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )

    return result.value
  }

// fallow-ignore-next-line unused-type
export type CreateLinkCategory = ReturnType<typeof createLinkCategory>
