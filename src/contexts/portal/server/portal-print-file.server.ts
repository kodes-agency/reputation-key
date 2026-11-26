// A print download is uncacheable before any refusal, checks the caller's scope,
// spends the address rate limit, then makes the file.

import { disableResponseCaching } from '#/shared/http/no-store.server'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getContainer } from '#/composition'
import { printKitDownloadOf } from '../printing/print-download.server'
import type { PortalPrintKitFile, PortalPrintKitDownload } from '../printing/contracts'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import {
  checkPortalAddressRateLimit,
  checkPortalPrintWordingRateLimit,
} from './portal-address-rate-limit.server'

/**
 * Runs a manager's print action behind the guards every one shares: the tenant
 * context, the caller's `authorize` (the Portal's scope and the manager's
 * rights), the action's rate limit spent, then `run`; a Portal error becomes the
 * context error the client reads.
 */
export async function guardedPortalPrintAction<T>(
  authorize: (ctx: AuthContext) => Promise<unknown>,
  run: (ctx: AuthContext) => Promise<T>,
  action: 'wording' | 'download',
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  try {
    await authorize(ctx)
    const checkLimit =
      action === 'download'
        ? checkPortalAddressRateLimit
        : checkPortalPrintWordingRateLimit
    const limited = await checkLimit({
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
  disableResponseCaching()
  return guardedPortalPrintAction(
    authorize,
    async (ctx) => printKitDownloadOf(await make(ctx)),
    'download',
  )
}
