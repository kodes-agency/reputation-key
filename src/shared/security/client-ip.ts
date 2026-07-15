// Trusted proxy utilities — B0.7 request boundary hardening.
//
// Derives the real client IP from X-Forwarded-For using a configurable
// number of trusted reverse proxies. Never trusts arbitrary forwarded
// headers beyond the configured proxy count.
//
// Usage:
//   const ip = getClientIp(event, trustedProxyCount)
//   // → "203.0.113.5"

/** Parse X-Forwarded-For and extract the client IP at the trusted position. */
export function getClientIpFromForwardedFor(
  forwardedFor: string | undefined,
  trustedProxyCount: number,
): string | undefined {
  if (!forwardedFor) return undefined

  // X-Forwarded-For: client, proxy1, proxy2, ...
  // With N trusted proxies, the client IP is at position length - (N+1)
  const hops = forwardedFor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (hops.length === 0) return undefined

  // If we have fewer hops than expected proxies, take the leftmost (original client)
  const clientIndex = Math.max(0, hops.length - trustedProxyCount - 1)
  return hops[clientIndex]
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
