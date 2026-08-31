// Trusted proxy utilities — B0.7 request boundary hardening.
//
// Derives the real client IP from X-Forwarded-For using a configurable
// number of trusted reverse proxies. Never trusts arbitrary forwarded
// headers beyond the configured proxy count.
//
// Usage:
//   const ip = getClientIp(event, trustedProxyCount)
//   // → "203.0.113.5"

import { isIP } from 'node:net'
import { getEnv } from '#/shared/config/env'

const DEFAULT_MAX_FORWARDED_HOPS = 8

function validIp(value: string): string | undefined {
  const candidate = value.trim()
  return isIP(candidate) === 0 ? undefined : candidate
}

/** Parse X-Forwarded-For and extract the client IP at the trusted position. */
export function getClientIpFromForwardedFor(
  forwardedFor: string | undefined,
  trustedProxyCount: number,
  maxHops = DEFAULT_MAX_FORWARDED_HOPS,
): string | undefined {
  if (!forwardedFor) return undefined

  // X-Forwarded-For: client, proxy1, proxy2, ...
  // The direct proxy is the socket peer and is not another XFF element. With N
  // trusted proxies, the first untrusted hop is therefore at length - N.
  if (forwardedFor.length > 2_048) return undefined
  const rawHops = forwardedFor.split(',')
  if (rawHops.some((hop) => hop.trim() === '')) return undefined
  const hops = rawHops.map((hop) => validIp(hop))

  if (hops.length === 0 || hops.some((hop) => hop === undefined)) return undefined

  if (
    !Number.isInteger(trustedProxyCount) ||
    trustedProxyCount < 1 ||
    !Number.isInteger(maxHops) ||
    maxHops < 1 ||
    hops.length > maxHops ||
    hops.length < trustedProxyCount
  ) {
    return undefined
  }

  return hops[hops.length - trustedProxyCount]
}

/**
 * Railway's public edge contract supplies the remote address in X-Real-IP and
 * adds Railway edge/request markers. The deployment mode is the primary trust
 * boundary; requiring both markers also makes accidental direct exposure fail
 * closed instead of silently accepting a caller-owned X-Real-IP header.
 */
export function getClientIpFromRailwayHeaders(headers: Headers): string | undefined {
  if (
    !headers.get('x-railway-edge')?.trim() ||
    !headers.get('x-railway-request-id')?.trim()
  ) {
    return undefined
  }
  const realIp = headers.get('x-real-ip')
  return realIp ? validIp(realIp) : undefined
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
  maxHops = DEFAULT_MAX_FORWARDED_HOPS,
): string {
  // When behind trusted proxies, derive from X-Forwarded-For
  if (trustedProxyCount > 0 && forwardedFor) {
    const ip = getClientIpFromForwardedFor(forwardedFor, trustedProxyCount, maxHops)
    if (ip) return ip
  }

  // Fallback to direct socket address
  return remoteAddress ?? 'unknown'
}

/**
 * Derive the client IP from server-function request headers using the
 * explicitly configured edge contract.
 *
 * This is the ONLY sanctioned way to read a client IP at the server-fn
 * boundary (BQC-7.6). Railway mode uses the platform's X-Real-IP contract and
 * ignores XFF. Generic XFF mode selects from the right after validating and
 * bounding the entire list. Server functions have no socket address, so direct
 * mode/failure returns 'unknown' (never a spoofable header value).
 */
export function clientIpFromHeaders(headers: Headers): string {
  const env = getEnv()
  if (env.TRUSTED_PROXY_MODE === 'railway-edge') {
    return getClientIpFromRailwayHeaders(headers) ?? 'unknown'
  }
  if (env.TRUSTED_PROXY_MODE === 'xff') {
    return deriveClientIp(
      undefined,
      headers.get('x-forwarded-for') ?? undefined,
      env.TRUSTED_PROXY_COUNT,
      env.TRUSTED_PROXY_MAX_HOPS,
    )
  }
  return 'unknown'
}
