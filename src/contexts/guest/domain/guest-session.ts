// POST-BETA-2 PB2.2: Guest session security model.
//
// Per ADR 0044: sessions are server-issued, signed, Secure, HttpOnly,
// and appropriately scoped SameSite. Client-side session creation is
// prohibited.
//
// This module defines the session contract and cookie attributes.
// The actual signing/encryption is handled by the server runtime.

export interface GuestSession {
  readonly sessionId: string
  readonly portalId: string
  readonly organizationId: string
  readonly propertyId: string
  readonly tokenVersion: number
  readonly issuedAt: Date
  readonly expiresAt: Date
  readonly campaignMediumHint: string | null
}

export interface SessionCookieAttributes {
  readonly name: string
  readonly value: string
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: 'strict' | 'lax' | 'none'
  readonly path: string
  readonly maxAge: number
}

export const SESSION_COOKIE_NAME = 'rk_guest_session'
export const DEFAULT_SESSION_DURATION_MS = 60 * 60 * 1000 // 1 hour

export function createSession(params: {
  sessionId: string
  portalId: string
  organizationId: string
  propertyId: string
  tokenVersion: number
  campaignMediumHint?: string
  durationMs?: number
  now: Date
}): GuestSession {
  const now = params.now
  const duration = params.durationMs ?? DEFAULT_SESSION_DURATION_MS
  return {
    sessionId: params.sessionId,
    portalId: params.portalId,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    tokenVersion: params.tokenVersion,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + duration),
    campaignMediumHint: params.campaignMediumHint ?? null,
  }
}

export function isSessionValid(session: GuestSession, asOf: Date): boolean {
  return asOf < session.expiresAt
}

/**
 * Build the cookie attributes for a guest session.
 * Per ADR 0044: Secure, HttpOnly, SameSite=Lax (allows top-level
 * navigation from QR scanner apps), scoped path.
 */
export function buildCookieAttributes(
  session: GuestSession,
  isHttps: boolean,
): SessionCookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value: session.sessionId,
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor((session.expiresAt.getTime() - session.issuedAt.getTime()) / 1000),
  }
}

/**
 * Build a Set-Cookie header value from session attributes.
 */
export function buildSetCookieHeader(attrs: SessionCookieAttributes): string {
  const parts = [
    `${attrs.name}=${attrs.value}`,
    `Path=${attrs.path}`,
    `Max-Age=${attrs.maxAge}`,
    `SameSite=${attrs.sameSite}`,
  ]
  if (attrs.httpOnly) parts.push('HttpOnly')
  if (attrs.secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Build a cookie-clearing header (expires immediately).
 */
export function buildClearCookieHeader(isHttps: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'SameSite=lax',
  ]
  parts.push('HttpOnly')
  if (isHttps) parts.push('Secure')
  return parts.join('; ')
}
