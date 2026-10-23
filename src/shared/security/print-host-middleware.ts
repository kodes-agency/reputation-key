// The print host's request middleware (ADR 0069): on the short host a printed QR
// code or NFC tag carries, `GET`/`HEAD /p/*` is a redirect to the app and anything
// else is a 404. What it decides is print-host-redirect.ts; this reads the
// configuration and the one header the app takes on trust.
//
// Registered once, globally, in src/start.ts, ahead of the CSRF boundary so that a
// server-function call on the print host is a 404 like any other request there.
// Where PORTAL_PRINT_ORIGIN is unset, or names the app's own host, it passes every
// request straight through.
//
// Which host a request is for. The server builds `request.url` from the wire `Host`
// and does not trust `X-Forwarded-*` (srvx's `trustProxy` is off), so the wire host
// is always used. `X-Forwarded-Host`, which Railway sets to the host the client
// asked for, counts as well wherever the app already trusts the proxy that sets it,
// by the contract the client address rests on: Railway's edge markers in
// railway-edge mode, a configured proxy in xff mode, never in direct mode. Both are
// checked for the same reason: the answer only narrows what a request gets.

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
    forwardedHost: trustsForwardedHost(env, request.headers)
      ? request.headers.get('x-forwarded-host')
      : null,
  })
}

export const printHostMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => answerForPrintHost(getEnv(), request) ?? next(),
)
