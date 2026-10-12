import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '#/shared/auth/auth'
import {
  claimsE2ERateLimitBypass,
  isE2ERateLimitBypassAuthorized,
} from '#/shared/auth/beta-capabilities'
import { requestRuntimeConfig } from '#/shared/config/request-runtime-config'
import { getContainer } from '#/composition'
import { getLogger } from '#/shared/observability/logger'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import { classifyProviderRequest } from './-provider-routes'

// The authentication provider's own HTTP routes are served from an ALLOW LIST
// (./-provider-routes.ts): a request reaches Better Auth only when its method
// and exact path name a route the product needs over HTTP. Every other
// request under /api/auth/* is refused here, so a provider route nobody
// decided on is never reachable. Refusing a list of paths did not hold: the
// provider's organization reads handed every invitation id to any member,
// and its create and update routes ran with none of the app's checks.
//
// Both lists name Better Auth's OWN routes, so they are only as correct as
// the version they were read against: the exact pin in package.json (1.7.5).
// The colocated tests enumerate the configured provider's endpoints and fail
// on one that is on neither list, and assert the installed version, so a bump
// is a deliberate re-read of what each allowed route returns and changes.
//
// App-owned server functions call the provider in process and never pass
// through this handler. The Google Business Profile OAuth callback has its own
// route file (./google/callback.ts).

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
  const env = requestRuntimeConfig().env
  if (isE2ERateLimitBypassAuthorized(env)) return true
  if (claimsE2ERateLimitBypass(env) && !bypassRefusalLogged) {
    bypassRefusalLogged = true
    getLogger().error(
      { nodeEnv: env.NODE_ENV },
      'auth.rate_limit_bypass_refused: E2E is set without an authorized test/CI execution identity (a deployed process never has one) — the auth catch-all limiter stays ENABLED',
    )
  }
  return false
}

/**
 * Handle a raw better-auth HTTP request. A request that is not on the allow
 * list is refused with 404 + a structured warn log (the alerting anchor), before
 * the limiter so a 429 cannot mask it. Allowed POSTs are rate-limited to blunt
 * brute-force / credential stuffing against better-auth native auth.
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
 * Exported for the colocated tests: this seam is what makes the allow list
 * and the limiter's posture provable without booting the route tree.
 */
export async function handleAuthRequest(
  request: Request,
  opts: { rateLimit: boolean },
): Promise<Response> {
  const { pathname } = new URL(request.url)
  const decision = classifyProviderRequest(request.method, pathname)
  if (!decision.allowed) {
    // The route is logged as its pattern, never the raw path: a path can carry
    // a mailed reset token, and a path that names no provider route is noise.
    getLogger().warn(
      { method: request.method, route: decision.route ?? 'unlisted' },
      'auth.raw_endpoint_blocked: raw better-auth endpoint is not on the allow list; use the app-owned service',
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
