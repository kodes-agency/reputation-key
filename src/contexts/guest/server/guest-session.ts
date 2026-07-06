// Guest session cookie helpers.
//
// The `guest_session` cookie is a 24h HttpOnly cookie that gives anonymous
// visitors a stable identity for rate-limiting and duplicate-rating dedup
// (see guest CONTEXT.md § Invariants). The server sets it on the first guest
// write so direct API callers — who bypass the client-side cookie init in the
// route component — still receive it and cannot mint a fresh session on every
// request to evade throttling.
//
// Named helpers (no `*.server.ts` suffix) because nothing here imports
// `node:`-only modules; only `setResponseHeader` is server-context bound and
// it is only invoked from inside server-function handler bodies.

import { setResponseHeader } from '@tanstack/react-start/server'

export const GUEST_SESSION_COOKIE = 'guest_session'
/** 24h, per guest CONTEXT.md § Invariants. */
export const GUEST_SESSION_MAX_AGE = 86_400

/** Parse the guest_session id from a Cookie header, or null when absent. */
export function parseGuestSessionId(cookieHeader: string): string | null {
  return cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? null
}

/** Build the raw Set-Cookie value for a guest session id. */
export function buildGuestSessionCookie(sessionId: string): string {
  return `${GUEST_SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Max-Age=${GUEST_SESSION_MAX_AGE}; Path=/p/`
}

export type GuestSession = Readonly<{
  sessionId: string
  /**
   * `true` when the cookie was already present (no Set-Cookie issued);
   * `false` when the id was freshly minted and a Set-Cookie was set.
   */
  fromCookie: boolean
}>

/**
 * Resolve the guest session for a public write, server-setting an HttpOnly
 * cookie on first contact. Must be called inside a server-function handler
 * (uses `setResponseHeader`).
 */
export function resolveGuestSession(cookieHeader: string): GuestSession {
  const existing = parseGuestSessionId(cookieHeader)
  if (existing) return { sessionId: existing, fromCookie: true }
  const sessionId = crypto.randomUUID()
  setResponseHeader('Set-Cookie', buildGuestSessionCookie(sessionId))
  return { sessionId, fromCookie: false }
}

/**
 * Rate-limit key for a guest public write. Keys on the stable session id when
 * the cookie is present; falls back to the IP hash when the request is
 * cookieless so a client that omits (or rotates) the cookie is still throttled
 * per source IP.
 */
export function guestRateLimitKey(
  kind: 'rating' | 'feedback' | 'scan',
  session: GuestSession,
  ipHash: string,
): string {
  return session.fromCookie ? `${kind}:${session.sessionId}` : `${kind}:ip:${ipHash}`
}
