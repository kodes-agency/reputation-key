// Portal context — the opening of every command on an existing link: the role
// may update Portals, the link exists, and the caller may reach its Property.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalLinkId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../domain/errors'
import { assertPortalPropertyAccess } from './assert-property-access'
import type { PortalLinkRepository } from './ports/portal-link.repository'
import type { PortalRepository } from './ports/portal.repository'

type Deps = Readonly<{
  portalLinkRepo: PortalLinkRepository
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
}>

export async function authorizeLinkCommand(deps: Deps, ctx: AuthContext, linkId: string) {
  if (!canForContext(ctx, 'portal.update')) {
    throw portalError('forbidden', 'this role cannot update portal links')
  }
  const target = await deps.portalLinkRepo.findLinkCommandTarget(
    ctx.organizationId,
    portalLinkId(linkId),
  )
  if (!target) throw portalError('link_not_found', 'link not found')
  const portal = await assertPortalPropertyAccess(
    deps.portalRepo,
    deps.staffPublicApi,
    ctx,
    'portal.update',
    target.link.portalId,
  )
  return { target, portal }
}
