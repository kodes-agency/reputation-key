// Portal context — list portal links use case
// Returns all categories and links for a portal, scoped to the organization.
// Read-only query — gated by can(ctx.role, 'portal.read') permission check.

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type ListPortalLinksInput = Readonly<{
  portalId: string
}>

// fallow-ignore-next-line unused-type
export type ListPortalLinksDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
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
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    const pid = portalId(input.portalId)
    // D6-001: verify caller can access this portal's property
    await assertPortalPropertyAccess(deps.portalRepo, deps.staffPublicApi, ctx, pid)
    const [categories, links] = await Promise.all([
      deps.portalLinkRepo.listCategories(ctx.organizationId, pid),
      deps.portalLinkRepo.listAllLinks(ctx.organizationId, pid),
    ])
    return { categories, links }
  }

// fallow-ignore-next-line unused-type
export type ListPortalLinks = ReturnType<typeof listPortalLinks>
