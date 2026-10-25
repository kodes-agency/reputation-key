// Portal context — the guards a print file's server functions share (today's
// print kit and the final one). Server only: a download puts the code's address
// into a file, so it marks the response uncacheable before anything can fail,
// checks the Portal's scope and the manager's rights, spends the same rate limit
// as "Download again", and only then makes the file.

import { setResponseHeader } from '@tanstack/react-start/server'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type { Permission } from '#/shared/domain/permissions'
import {
  printKitDownloadOf,
  type PortalPrintKitDownload,
  type PortalPrintKitFile,
} from '../application/use-cases/create-portal-print-kit'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { checkPortalAddressRateLimit } from './portal-address-rate-limit.server'
import { requirePortalResourceScope } from './property-scope'

export async function authorizePortalPrint(
  ctx: AuthContext,
  rawPortalId: string,
  action: Permission,
  capability: Capability,
): Promise<void> {
  await requirePortalResourceScope({
    actor: ctx,
    action,
    capability,
    notFound: portalError('portal_not_found', 'portal not found'),
    lookup: () =>
      getContainer().portalPublicApi.management.resolvePortalManagementScope(
        portalId(rawPortalId),
      ),
  })
}

/** The file contains the live code's address: nothing in the path may keep a copy. */
function disableFileCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

/**
 * Makes a print file for a manager: no copy kept anywhere, the Portal's scope
 * and the manager's rights checked, the address rate limit spent, then `make`.
 */
export async function downloadPortalPrintFile(
  rawPortalId: string,
  make: (ctx: AuthContext) => Promise<PortalPrintKitFile>,
): Promise<PortalPrintKitDownload> {
  disableFileCaching()
  const ctx = await resolveTenantContext(await headersFromContext())
  try {
    await authorizePortalPrint(ctx, rawPortalId, 'portal.update', 'portal.write')
    const limited = await checkPortalAddressRateLimit({
      rateLimiter: getContainer().rateLimiter,
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
    })
    if (limited) throw limited
    return printKitDownloadOf(await make(ctx))
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}
