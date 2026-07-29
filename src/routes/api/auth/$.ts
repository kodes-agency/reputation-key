import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '#/shared/auth/auth'
import { getContainer } from '#/composition'
import { getLogger } from '#/shared/observability/logger'

// Raw better-auth organization write endpoints PERMANENTLY blocked at the HTTP
// boundary — app-owned services are the only write path (ADR 0001, DAC Stage 1).
// Paths verified against better-auth 1.6.12 organization plugin route files
// (crud-access-control.mjs / crud-invites.mjs / crud-members.mjs). The invitation
// create path is "/organization/invite-member", not "/create-invitation".
const BLOCKED_RAW_WRITE_ENDPOINTS = [
  '/organization/create-role',
  '/organization/update-role',
  '/organization/delete-role',
  '/organization/invite-member',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
  '/organization/cancel-invitation',
  '/organization/update-member-role',
  '/organization/remove-member',
] as const

/**
 * Handle a raw better-auth HTTP request. Blocked write endpoints are refused with
 * 404 + a structured warn log (the alerting anchor). POST endpoints are rate-limited
 * to blunt brute-force / credential stuffing against better-auth native auth.
 *
 * BQC-6.8: the limiter is skipped on Playwright-launched dev servers (E2E=1 —
 * the same discriminator vite.config.ts uses). The 60-POSTs/60s fixed window
 * per IP was sized for interactive traffic; the e2e suite signs in per test
 * (~70 POSTs in ~70s once the accessibility spec joined), and retries: 0
 * makes a single 429 fatal. No spec exercises rate-limit behavior. Production
 * and local-dev limiting are unchanged (better-auth's own limiter inside the
 * handler is likewise e2e-disabled, see shared/auth/auth.ts).
 */
async function handleAuthRequest(
  request: Request,
  opts: { rateLimit: boolean },
): Promise<Response> {
  const { pathname } = new URL(request.url)
  // endsWith tolerates the configured better-auth base path prefix (e.g. /api/auth).
  if (BLOCKED_RAW_WRITE_ENDPOINTS.some((suffix) => pathname.endsWith(suffix))) {
    getLogger().warn(
      { method: request.method, url: request.url },
      'auth.raw_write_endpoint_blocked: raw better-auth write endpoint refused; use the app-owned service',
    )
    return new Response(JSON.stringify({ message: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (opts.rateLimit && !process.env.E2E) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const { rateLimiter } = getContainer()
    const rlResult = await rateLimiter.check(`auth:native:${ip}`)
    if (!rlResult.allowed) {
      return new Response(
        JSON.stringify({ message: 'Too many requests. Please try again later.' }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
  }

  return getAuth().handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request, { rateLimit: false }),
      POST: ({ request }) => handleAuthRequest(request, { rateLimit: true }),
    },
  },
})
