// Portal context — update link category use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLinkCategory } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { validateCategoryTitle } from '../../domain/rules'
import { canForContext } from '#/shared/domain/permissions'
import { portalLinkCategoryId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'
import { portalLinkCategoryUpdated } from '../../domain/events'

export type UpdateLinkCategoryInput = Readonly<{
  categoryId: string
  title?: string
}>

export type UpdateLinkCategoryDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const updateLinkCategory =
  (deps: UpdateLinkCategoryDeps) =>
  async (
    input: UpdateLinkCategoryInput,
    ctx: AuthContext,
  ): Promise<PortalLinkCategory> => {
    // 1. Authorize
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot update portal categories')
    }

    const target = await deps.portalLinkRepo.findCategoryCommandTarget(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
    if (!target) {
      throw portalError('category_not_found', 'category not found')
    }
    const existing = target.category
    // Enforce property-assignment scoping (D6-001.)
    const portal = await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      'portal.update',
      existing.portalId,
    )

    if (input.title !== undefined) {
      const r = validateCategoryTitle(input.title)
      if (r.isErr()) throw r.error
      const occurredAt = deps.clock()
      const expectedPortalUpdatedAt = target.portalUpdatedAt ?? portal.updatedAt
      const revision = nextPortalCommandAt(occurredAt, expectedPortalUpdatedAt)
      await deps.commandStore.updatePortalLinkCategory({
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        portalId: existing.portalId,
        expectedPortalUpdatedAt,
        revision,
        occurredAt,
        categoryId: existing.id,
        title: r.value,
        event: portalLinkCategoryUpdated({
          portalId: existing.portalId,
          categoryId: existing.id,
          organizationId: ctx.organizationId,
          propertyId: portal.propertyId,
          sourceAggregateVersion: revision.toISOString(),
          occurredAt,
        }),
      })
      return { ...existing, title: r.value, updatedAt: occurredAt }
    }

    return existing
  }

export type UpdateLinkCategory = ReturnType<typeof updateLinkCategory>
