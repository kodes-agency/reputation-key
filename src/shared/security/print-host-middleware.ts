// The print host's request middleware (ADR 0069): on the short host a printed QR
// code or NFC tag carries, `GET`/`HEAD /p/*` is a redirect to the app and anything
// else is a 404. What it decides is print-host-redirect.ts; this reads the
// configuration and the one header the app takes on trust.
//
// Registered once, globally, in src/start.ts, ahead of the CSRF boundary so that a
// server-function call on the print host is a 404 like any other request there.
// Where PORTAL_PRINT_ORIGIN is unset, or names the app's own host, it passes every
// request straight through. Files Nitro serves from its public directory (/assets,
// robots.txt, favicon.ico) are answered before any request middleware runs, so they
// still answer on the print host: public build files, the same ones the app host
// serves. So does Start's own repair of a path that begins `//`: a 308 to the same
// host with one slash, which meets this middleware's answer a hop later.
//
// Which host a request is for. The server builds `request.url` from the wire `Host`
// and does not trust `X-Forwarded-*` (srvx's `trustProxy` is off), so the wire host
// is always used: the host of the URL and the `Host` header itself. Both are read
// because the URL's host is a placeholder where the server does not accept the
// `Host` (a trailing dot) and is the request target's own where that is in absolute
// form. `X-Forwarded-Host`, which Railway sets to the host the client asked for,
// counts as well wherever the app already trusts the proxy that sets it, by the
// contract the client address rests on: Railway's edge markers in railway-edge mode,
// a configured proxy in xff mode, never in direct mode. All are checked for the same
// reason: the answer only narrows what a request gets.

import { createMiddleware } from '@tanstack/react-start'
import { getEnv, type Env } from '#/shared/config/env'
import { hasRailwayEdgeMarkers } from './client-ip'
import { answerPrintHost, printHostPolicy } from './print-host-redirect'

type PrintHostEnv = Pick<
  Env,
  'PORTAL_PRINT_ORIGIN' | 'BETTER_AUTH_URL' | 'TRUSTED_PROXY_MODE' | 'TRUSTED_PROXY_COUNT'
>

function trustsForwardedHost(env: PrintHostEnv, headers: Headers): boolean {
  if (env.TRUSTED_PROXY_MODE === 'railway-edge') return hasRailwayEdgeMarkers(headers)
  return env.TRUSTED_PROXY_MODE === 'xff' && env.TRUSTED_PROXY_COUNT >= 1
}

function answerForPrintHost(env: PrintHostEnv, request: Request): Response | null {
  const policy = printHostPolicy(env.PORTAL_PRINT_ORIGIN, env.BETTER_AUTH_URL)
  if (policy === null) return null
  return answerPrintHost(policy, {
    method: request.method,
    url: request.url,
    hostHeader: request.headers.get('host'),
    forwardedHost: trustsForwardedHost(env, request.headers)
      ? request.headers.get('x-forwarded-host')
      : null,
  })
}

export const printHostMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => answerForPrintHost(getEnv(), request) ?? next(),
)
