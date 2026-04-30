// Portal context — delete link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'
import { portalLinkId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type DeleteLinkDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
}>

export const deleteLink =
  (deps: DeleteLinkDeps) =>
  async (input: { linkId: string }, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot delete portal links')
    }

    const existing = await deps.portalLinkRepo.findLinkById(
      ctx.organizationId,
      portalLinkId(input.linkId),
    )
    if (!existing) {
      throw portalError('link_not_found', 'link not found')
    }

    await deps.portalLinkRepo.deleteLink(ctx.organizationId, portalLinkId(input.linkId))
  }

// fallow-ignore-next-line unused-type
export type DeleteLink = ReturnType<typeof deleteLink>
