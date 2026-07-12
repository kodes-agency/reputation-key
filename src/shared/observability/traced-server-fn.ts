// Traced server function handler wrapper.
// Wraps a createServerFn handler with ALS request context,
// root request span, and a safety net for untagged errors.
//
// Usage:
//   import { createServerFn } from '@tanstack/react-start'
//   import { tracedHandler } from '#/shared/observability/traced-server-fn'
//
//   export const getPortal = createServerFn({ method: 'GET' })
//     .inputValidator(schema)
//     .handler(tracedHandler(async ({ data }) => { ... }))
//
// Existing try/catch blocks inside handlers stay — they handle domain-specific error mapping.
// This wrapper adds ALS + request span + catches anything that slips through as a 500.

import {
  enrichSpan,
  generateRequestId,
  runWithContext,
} from '#/shared/observability/request-context'
import { startRequestSpan } from '#/shared/observability/trace'
import { ServerFunctionError, catchUntagged } from '#/shared/auth/server-errors'
// clearTenantCache import removed (AC-02): we no longer call it unconditionally after every fn.
// import { clearTenantCache } from '#/shared/auth/middleware'
import { getLogger } from '#/shared/observability/logger'

/**
 * Wraps a server function handler with tracing and error safety net.
 * Preserves the original handler's type signature.
 */
export function tracedHandler<TInput, TOutput>(
  fn: (ctx: { data: TInput }) => Promise<TOutput>,
  method: 'GET' | 'POST' = 'POST',
  name?: string,
): (ctx: { data: TInput }) => Promise<TOutput> {
  return (ctx: { data: TInput }) => {
    const requestId = generateRequestId()
    const span = startRequestSpan(requestId, method, name ?? 'serverFn')
    const log = getLogger().child({
      component: 'server-fn',
      fn: name ?? 'serverFn',
      method,
    })
    const start = Date.now()

    return runWithContext(requestId, async () => {
      // Seed the span with the operation name so trace() spans and handler-body
      // log calls carry it even before resolveTenantContext enriches identity.
      // Tenant identity (org/user/role) is enriched by resolveTenantContext.
      enrichSpan({ useCase: name ?? 'serverFn' })
      try {
        const result = await fn(ctx)
        log.info({ duration: Date.now() - start }, 'request complete')
        span.end()
        // clearTenantCache() softened per auth-caching plan (AC-02): rely primarily on TTL + permission_version check.
        // Periodic or on-demand cleanup is sufficient; unconditional per-fn clear reduced hit rate across page loads.
        // clearTenantCache() // intentionally de-emphasized
        return result
      } catch (e) {
        span.end(e)
        // clearTenantCache() // see above
        // Already a ServerFunctionError (tagged by domain catch block) — just re-throw
        if (e instanceof ServerFunctionError) {
          throw e
        }
        // Untagged error — log full detail and wrap as generic 500
        catchUntagged(e)
      }
    }) as Promise<TOutput>
  }
}
