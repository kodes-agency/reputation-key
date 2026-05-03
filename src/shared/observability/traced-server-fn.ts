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

import { generateRequestId, runWithContext } from '#/shared/observability/request-context'
import { startRequestSpan } from '#/shared/observability/trace'
import { ServerFunctionError, catchUntagged } from '#/shared/auth/server-errors'
import { clearTenantCache } from '#/shared/auth/middleware'

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

    return runWithContext(requestId, async () => {
      try {
        const result = await fn(ctx)
        span.end()
        clearTenantCache()
        return result
      } catch (e) {
        span.end(e)
        clearTenantCache()
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
