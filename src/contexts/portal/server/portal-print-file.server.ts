// Portal context — the guards a print file's server functions share (today's
// print kit and the final one). Server only: a download puts the code's address
// into a file, so it marks the response uncacheable before anything can fail,
// runs the caller's scope and rights check, spends the same rate limit as
// "Download again", and only then makes the file.

import { setResponseHeader } from '@tanstack/react-start/server'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import {
  printKitDownloadOf,
  type PortalPrintKitDownload,
  type PortalPrintKitFile,
} from '../application/use-cases/create-portal-print-kit'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { checkPortalAddressRateLimit } from './portal-address-rate-limit.server'

/**
 * The Portal a print is for, as `requirePortalResourceScope` looks it up: its
 * management scope, or "portal not found". Each server function names its own
 * permission and capability beside it.
 */
export function portalPrintScope(rawPortalId: string) {
  return {
    notFound: portalError('portal_not_found', 'portal not found'),
    lookup: () =>
      getContainer().portalPublicApi.management.resolvePortalManagementScope(
        portalId(rawPortalId),
      ),
  }
}

/** The file contains the live code's address: nothing in the path may keep a copy. */
function disableFileCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

/**
 * Runs a manager's print action behind the guards every one shares: the tenant
 * context, the caller's `authorize` (the Portal's scope and the manager's
 * rights), the address rate limit spent, then `run`; a Portal error becomes the
 * context error the client reads.
 */
export async function guardedPortalPrintAction<T>(
  authorize: (ctx: AuthContext) => Promise<unknown>,
  run: (ctx: AuthContext) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  try {
    await authorize(ctx)
    const limited = await checkPortalAddressRateLimit({
      rateLimiter: getContainer().rateLimiter,
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
    })
    if (limited) throw limited
    return await run(ctx)
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}

/**
 * Makes a print file for a manager: no copy kept anywhere, the caller's
 * `authorize` (the Portal's scope and the manager's rights), the address rate
 * limit spent, then `make`.
 */
export function downloadPortalPrintFile(
  authorize: (ctx: AuthContext) => Promise<unknown>,
  make: (ctx: AuthContext) => Promise<PortalPrintKitFile>,
): Promise<PortalPrintKitDownload> {
  disableFileCaching()
  return guardedPortalPrintAction(authorize, async (ctx) =>
    printKitDownloadOf(await make(ctx)),
  )
}
