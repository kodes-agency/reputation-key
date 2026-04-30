// Portal context — update link category use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLinkCategory } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { validateCategoryTitle } from '../../domain/rules'
import { can } from '#/shared/domain/permissions'
import { portalLinkCategoryId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type UpdateLinkCategoryDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
  clock: () => Date
}>

export const updateLinkCategory =
  (deps: UpdateLinkCategoryDeps) =>
  async (
    input: { categoryId: string; title?: string },
    ctx: AuthContext,
  ): Promise<PortalLinkCategory> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot update portal categories')
    }

    const existing = await deps.portalLinkRepo.findCategoryById(
      ctx.organizationId,
      portalLinkCategoryId(input.categoryId),
    )
    if (!existing) {
      throw portalError('category_not_found', 'category not found')
    }

    if (input.title !== undefined) {
      const r = validateCategoryTitle(input.title)
      if (r.isErr()) throw r.error
      const updatedAt = deps.clock()
      await deps.portalLinkRepo.updateCategory(ctx.organizationId, portalLinkCategoryId(input.categoryId), {
        title: r.value,
        updatedAt,
      })
      return { ...existing, title: r.value, updatedAt }
    }

    return existing
  }

// fallow-ignore-next-line unused-type
export type UpdateLinkCategory = ReturnType<typeof updateLinkCategory>
