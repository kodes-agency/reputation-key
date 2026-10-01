// Portal context — the one way a read server function checks the Portal's scope.
// Resolve the Portal's Property, require `portal.read` there, run the read, and
// translate Portal errors into context errors. Thin: no read lives here.

import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { requirePortalResourceScope } from './property-scope'

/** The read scope the Portal's reads ask for, then the read itself, with errors translated. */
export async function readWithScope<T>(
  ctx: AuthContext,
  id: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    await requirePortalResourceScope({
      actor: ctx,
      action: 'portal.read',
      capability: 'portal.read',
      notFound: portalError('portal_not_found', 'portal not found'),
      lookup: () =>
        getContainer().portalPublicApi.management.resolvePortalManagementScope(
          portalId(id),
        ),
    })
    return await read()
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}
