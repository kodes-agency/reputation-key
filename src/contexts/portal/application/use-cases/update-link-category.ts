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

// fallow-ignore-next-line unused-type
export type UpdateLinkCategoryInput = Readonly<{
  categoryId: string
  title?: string
}>

// fallow-ignore-next-line unused-type
export type UpdateLinkCategoryDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
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

    const existing = await deps.portalLinkRepo.findCategoryById(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
    if (!existing) {
      throw portalError('category_not_found', 'category not found')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      'portal.update',
      existing.portalId,
    )

    if (input.title !== undefined) {
      const r = validateCategoryTitle(input.title)
      if (r.isErr()) throw r.error
      const updatedAt = deps.clock()
      await deps.portalLinkRepo.updateCategory(
        ctx.organizationId,
        portalLinkCategoryId(input.categoryId),
        {
          title: r.value,
          updatedAt,
        },
      )
      return { ...existing, title: r.value, updatedAt }
    }

    return existing
  }

// fallow-ignore-next-line unused-type
export type UpdateLinkCategory = ReturnType<typeof updateLinkCategory>
