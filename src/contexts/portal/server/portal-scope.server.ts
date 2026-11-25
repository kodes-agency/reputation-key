// The Portal scope lookups every server function authorises with. A .server
// file: it reads the container, which a server-function file must not export.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { Capability } from '#/shared/auth/beta-capabilities'
import { getContainer } from '#/composition'
import { portalGroupId, portalId } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import { requirePortalResourceScope, type PortalResourceScope } from './property-scope'

/** A read needs the read capability; every other action needs the write one. */
export function portalCapabilityOf(action: Permission): Capability {
  return action === 'portal.read' ? 'portal.read' : 'portal.write'
}

/** The Portal's management scope, or null when it does not exist. */
export function portalScopeLookup(rawPortalId: string) {
  return () =>
    getContainer().portalPublicApi.management.resolvePortalManagementScope(
      portalId(rawPortalId),
    )
}

/** Admits the caller to the Portal's scope for `action`; "portal not found" otherwise. */
export function requirePortalScope(
  ctx: AuthContext,
  rawPortalId: string,
  action: Permission,
): Promise<PortalResourceScope> {
  return requirePortalResourceScope({
    actor: ctx,
    action,
    capability: portalCapabilityOf(action),
    notFound: portalError('portal_not_found', 'portal not found'),
    lookup: portalScopeLookup(rawPortalId),
  })
}

/** The same for a Portal group, with "group not found". */
export function requirePortalGroupScope(
  ctx: AuthContext,
  rawGroupId: string,
  action: Permission,
): Promise<PortalResourceScope> {
  return requirePortalResourceScope({
    actor: ctx,
    action,
    capability: portalCapabilityOf(action),
    notFound: portalError('group_not_found', 'portal group not found'),
    lookup: () =>
      getContainer().portalPublicApi.management.resolvePortalGroupManagementScope(
        portalGroupId(rawGroupId),
      ),
  })
}
