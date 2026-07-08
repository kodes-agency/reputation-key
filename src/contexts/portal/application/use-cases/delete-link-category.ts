// Portal context — delete link category use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { portalLinkCategoryId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type DeleteLinkCategoryInput = Readonly<{
  categoryId: string
}>

// fallow-ignore-next-line unused-type
export type DeleteLinkCategoryDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
}>

export const deleteLinkCategory =
  (deps: DeleteLinkCategoryDeps) =>
  async (input: DeleteLinkCategoryInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot delete portal categories')
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

    await deps.portalLinkRepo.deleteCategory(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
  }

// fallow-ignore-next-line unused-type
export type DeleteLinkCategory = ReturnType<typeof deleteLinkCategory>
