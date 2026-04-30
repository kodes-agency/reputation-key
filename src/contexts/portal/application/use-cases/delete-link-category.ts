// Portal context — delete link category use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'
import { portalLinkCategoryId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type DeleteLinkCategoryDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
}>

export const deleteLinkCategory =
  (deps: DeleteLinkCategoryDeps) =>
  async (input: { categoryId: string }, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot delete portal categories')
    }

    const existing = await deps.portalLinkRepo.findCategoryById(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
    if (!existing) {
      throw portalError('category_not_found', 'category not found')
    }

    await deps.portalLinkRepo.deleteCategory(ctx.organizationId, portalLinkCategoryId(input.categoryId))
  }

// fallow-ignore-next-line unused-type
export type DeleteLinkCategory = ReturnType<typeof deleteLinkCategory>
