// Trusted proxy utilities — B0.7 request boundary hardening.
//
// Derives the real client IP from X-Forwarded-For using a configurable
// number of trusted reverse proxies. Never trusts arbitrary forwarded
// headers beyond the configured proxy count.
//
// Usage:
//   const ip = getClientIp(event, trustedProxyCount)
//   // → "203.0.113.5"

import { getEnv } from '#/shared/config/env'

/** Parse X-Forwarded-For and extract the client IP at the trusted position. */
export function getClientIpFromForwardedFor(
  forwardedFor: string | undefined,
  trustedProxyCount: number,
): string | undefined {
  if (!forwardedFor) return undefined

  // X-Forwarded-For: client, proxy1, proxy2, ...
  // The direct proxy is the socket peer and is not another XFF element. With N
  // trusted proxies, the first untrusted hop is therefore at length - N.
  const hops = forwardedFor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (hops.length === 0) return undefined

  if (
    !Number.isInteger(trustedProxyCount) ||
    trustedProxyCount < 1 ||
    hops.length < trustedProxyCount
  ) {
    return undefined
  }

  return hops[hops.length - trustedProxyCount]
}

/**
 * Derive the client IP from a Nitro/H3 event using trusted proxy configuration.
 *
 * @param remoteAddress - The direct socket address from event.node.req.socket.remoteAddress
 * @param forwardedFor - The X-Forwarded-For header value
 * @param trustedProxyCount - Number of trusted reverse proxies (from env TRUSTED_PROXY_COUNT)
 * @returns The best estimate of the real client IP
 */
export function deriveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | undefined,
  trustedProxyCount: number,
): string {
  // When behind trusted proxies, derive from X-Forwarded-For
  if (trustedProxyCount > 0 && forwardedFor) {
    const ip = getClientIpFromForwardedFor(forwardedFor, trustedProxyCount)
    if (ip) return ip
  }

  // Fallback to direct socket address
  return remoteAddress ?? 'unknown'
}

/**
 * Derive the client IP from server-function request headers using the
 * configured trusted proxy count (env TRUSTED_PROXY_COUNT, default 1).
 *
 * This is the ONLY sanctioned way to read a client IP at the server-fn
 * boundary (BQC-7.6): a client can prepend spoofed values, so with N trusted
 * proxies the client IP sits at position length-N. The direct socket proxy is
 * not duplicated in XFF; subtracting N+1 trusts one attacker-controlled hop.
 * Server functions have no socket address, so the fallback is 'unknown'
 * (never a spoofable header value).
 */
export function clientIpFromHeaders(headers: Headers): string {
  return deriveClientIp(
    undefined,
    headers.get('x-forwarded-for') ?? undefined,
    getEnv().TRUSTED_PROXY_COUNT,
  )
}
