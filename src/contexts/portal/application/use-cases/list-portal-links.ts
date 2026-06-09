// Portal context — list portal links use case
// Returns all categories and links for a portal, scoped to the organization.
// Read-only query — follows the same pattern as listPortals (no permission gate
// since all authenticated roles can view portals and their links).

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'
import { portalId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type ListPortalLinksInput = Readonly<{
  portalId: string
}>

// fallow-ignore-next-line unused-type
export type ListPortalLinksDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
}>

export const listPortalLinks =
  (deps: ListPortalLinksDeps) =>
  async (
    input: ListPortalLinksInput,
    ctx: AuthContext,
  ): Promise<{
    categories: Awaited<ReturnType<PortalLinkRepository['listCategories']>>
    links: Awaited<ReturnType<PortalLinkRepository['listAllLinks']>>
  }> => {
    if (!can(ctx.role, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    const pid = portalId(input.portalId)
    const [categories, links] = await Promise.all([
      deps.portalLinkRepo.listCategories(ctx.organizationId, pid),
      deps.portalLinkRepo.listAllLinks(ctx.organizationId, pid),
    ])
    return { categories, links }
  }

// fallow-ignore-next-line unused-type
export type ListPortalLinks = ReturnType<typeof listPortalLinks>
