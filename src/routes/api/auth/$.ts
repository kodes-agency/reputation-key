import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '#/shared/auth/auth'
import {
  claimsE2ERateLimitBypass,
  isE2ERateLimitBypassAuthorized,
} from '#/shared/auth/beta-capabilities'
import { getEnv } from '#/shared/config/env'
import { getContainer } from '#/composition'
import { getLogger } from '#/shared/observability/logger'
import { clientIpFromHeaders } from '#/shared/security/client-ip'

// Raw better-auth write endpoints PERMANENTLY blocked at the HTTP boundary.
//
// This list is PATH-PINNED against better-auth's own route table, so it is only
// as correct as the version it was verified against: every path below was
// re-verified present in better-auth 1.6.23 (the exact pin in package.json).
// A bump can rename a route and silently narrow this refusal to nothing, so
// the colocated test asserts the installed version and fails on drift —
// re-verify the org plugin route files, then move the pin.
//
// Organization writes: app-owned services are the only write path (ADR 0001,
// DAC Stage 1). Paths verified against the organization plugin route files
// (crud-access-control.mjs / crud-invites.mjs / crud-members.mjs). The
// invitation create path is "/organization/invite-member", not
// "/create-invitation".
//
// Self-service sign-up: /sign-up/email is an unauthenticated user-row write on
// a public, internet-reachable deployment, and the closed beta onboards by
// invitation only. Refused here rather than by clearing better-auth's
// emailAndPassword.enabled (src/shared/auth/auth.ts), which would also disable
// sign-in and password reset for existing members.
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
  '/organization/delete',
  '/organization/leave',
  '/sign-up/email',
] as const

/** One refusal log per process — the hatch is a boot-time posture, not per-request news. */
let bypassRefusalLogged = false

/**
 * Whether the E2E hatch stands the shared limiter down for this process
 * (review §5.1). Requires E2E=1 exactly AND the same test/CI execution
 * identity that authorizes the capability override; every other state keeps
 * the limiter ON. `E2E` reaches here through the zod schema, so a near-miss
 * value ('0', 'true') already refused boot rather than opening the endpoint.
 */
function authRateLimitBypassed(): boolean {
  const env = getEnv()
  if (isE2ERateLimitBypassAuthorized(env)) return true
  if (claimsE2ERateLimitBypass(env) && !bypassRefusalLogged) {
    bypassRefusalLogged = true
    getLogger().error(
      { nodeEnv: env.NODE_ENV },
      'auth.rate_limit_bypass_refused: E2E is set without a test/CI execution identity — the auth catch-all limiter stays ENABLED',
    )
  }
  return false
}

/**
 * Handle a raw better-auth HTTP request. Blocked write endpoints are refused with
 * 404 + a structured warn log (the alerting anchor). POST endpoints are rate-limited
 * to blunt brute-force / credential stuffing against better-auth native auth.
 *
 * BQC-6.8 / review §5.1: the 60-POSTs/60s fixed window per IP was sized for
 * interactive traffic; the e2e suite signs in per test (~70 POSTs in ~70s once
 * the accessibility spec joined) and retries: 0 makes a single 429 fatal, so
 * the Playwright-launched stack stands the limiter down. That hatch used to be
 * `!process.env.E2E` — bare truthiness on a variable absent from the env
 * schema — which let one stray env var disable both auth brute-force layers in
 * a real deployment with no signal; it now requires an exact value plus an
 * authorized execution identity (authRateLimitBypassed). Production and
 * local-dev limiting are unchanged (better-auth's own limiter inside the
 * handler is gated by the same rule, see shared/auth/auth.ts).
 *
 * Exported for the colocated test: this seam is what makes the blocked-endpoint
 * refusals and the limiter's posture provable without booting the route tree.
 */
export async function handleAuthRequest(
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

  if (opts.rateLimit && !authRateLimitBypassed()) {
    const ip = clientIpFromHeaders(request.headers)
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
