// Keep composition and error helpers server-only. Exporting this plain helper
// from an RPC module would leak server imports into the browser; handler-only
// imports are stripped with the handler bodies.

import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { isDashboardError } from '../domain/dashboard-errors'
import { dashboardErrorStatus } from './dashboard-error-status'

/**
 * Runs one Dashboard request: resolves the tenant, runs the body, and maps a
 * DashboardError to its HTTP status once. The tenant is resolved inside the
 * try, so an auth failure is tagged the same way as any other.
 */
export async function withDashboard<T>(
  run: (ctx: AuthContext) => Promise<T>,
): Promise<T> {
  try {
    return await run(await resolveTenantContext(await headersFromContext()))
  } catch (error) {
    if (isDashboardError(error)) {
      throwContextError('DashboardError', error, dashboardErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}
