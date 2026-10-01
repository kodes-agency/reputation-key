// Portal context — list portal links use case
// Returns the links of a portal, scoped to the organization. The editor shows
// no categories, so none are read.
// Read-only query — gated by can(ctx.role, 'portal.read') permission check.

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'

export type ListPortalLinksInput = Readonly<{
  portalId: string
}>

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
    links: Awaited<ReturnType<PortalLinkRepository['listAllLinks']>>
  }> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    const pid = portalId(input.portalId)
    // D6-001: verify caller can access this portal's property
    await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      'portal.read',
      pid,
    )
    const links = await deps.portalLinkRepo.listAllLinks(ctx.organizationId, pid)
    return { links }
  }

export type ListPortalLinks = ReturnType<typeof listPortalLinks>
