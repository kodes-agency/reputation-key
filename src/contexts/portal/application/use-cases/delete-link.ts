// Portal context — delete link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { portalLinkId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type DeleteLinkInput = Readonly<{
  linkId: string
}>

// fallow-ignore-next-line unused-type
export type DeleteLinkDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
}>

export const deleteLink =
  (deps: DeleteLinkDeps) =>
  async (input: DeleteLinkInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot delete portal links')
    }

    const existing = await deps.portalLinkRepo.findLinkById(
      ctx.organizationId,
      portalLinkId(input.linkId),
    )
    if (!existing) {
      throw portalError('link_not_found', 'link not found')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      existing.portalId,
    )

    await deps.portalLinkRepo.deleteLink(ctx.organizationId, portalLinkId(input.linkId))
  }

// fallow-ignore-next-line unused-type
export type DeleteLink = ReturnType<typeof deleteLink>
