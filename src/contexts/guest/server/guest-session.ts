import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  buildCookieAttributes,
  buildSetCookieHeader,
  createSession,
  isSessionValid,
  SESSION_COOKIE_NAME,
  type GuestSession,
} from '../domain/guest-session'
import type {
  RateLimitCheckOptions,
  RateLimiter,
  RateLimitResult,
} from '#/shared/rate-limit/middleware'

export type GuestSessionScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
}>

export type GuestSessionManager = Readonly<{
  issue(
    scope: GuestSessionScope,
  ): Readonly<{ session: GuestSession; cookies: readonly [string, string, string] }>
  /** Re-sign the same recovery identity only until an existing domain deadline. */
  renewUntil(
    session: GuestSession,
    expiresAt: Date,
  ): Readonly<{
    session: GuestSession
    cookies: readonly [string, string, string]
  }> | null
  verify(cookieHeader: string, scope: GuestSessionScope): GuestSession | null
  verifyCsrf(session: GuestSession, presented: string): boolean
}>

type SignedSessionPayload = Readonly<{
  v: 1
  sid: string
  csrf: string
  org: string
  property: string
  portal: string
  issued: string
  expires: string
}>

function readCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

export function createGuestSessionManager(
  input: Readonly<{
    secret: string
    secureCookies: boolean
    clock: () => Date
    randomId?: () => string
  }>,
): GuestSessionManager {
  if (Buffer.byteLength(input.secret, 'utf8') < 16) {
    throw new Error('Guest session secret must contain at least 16 bytes')
  }
  const randomId = input.randomId ?? randomUUID
  const sign = (payload: string) =>
    createHmac('sha256', input.secret).update(payload).digest('base64url')
  const serialize = (session: GuestSession) => {
    const payload: SignedSessionPayload = {
      v: 1,
      sid: session.sessionId,
      csrf: session.csrfNonce,
      org: session.organizationId,
      property: session.propertyId,
      portal: session.portalId,
      issued: session.issuedAt.toISOString(),
      expires: session.expiresAt.toISOString(),
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const cookieAttrs = buildCookieAttributes(session, input.secureCookies)
    const signedValue = `${encoded}.${sign(encoded)}`
    return {
      session,
      cookies: [
        buildSetCookieHeader({ ...cookieAttrs, value: signedValue }),
        buildSetCookieHeader({
          ...cookieAttrs,
          value: signedValue,
          path: '/_serverFn/',
        }),
        buildSetCookieHeader({
          ...cookieAttrs,
          value: signedValue,
          path: '/api/public/p/',
        }),
      ] as const,
    }
  }

  return {
    issue: (scope) => {
      const session = createSession({
        sessionId: randomId(),
        csrfNonce: randomId(),
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        portalId: scope.portalId,
        tokenVersion: 0,
        now: input.clock(),
      })
      return serialize(session)
    },

    renewUntil: (session, expiresAt) => {
      const now = input.clock()
      if (
        expiresAt.getTime() <= now.getTime() ||
        expiresAt.getTime() - now.getTime() > 24 * 60 * 60 * 1000
      ) {
        return null
      }
      return serialize({ ...session, issuedAt: now, expiresAt })
    },

    verify: (cookieHeader, scope) => {
      const raw = readCookie(cookieHeader)
      if (!raw) return null
      const separator = raw.lastIndexOf('.')
      if (separator < 1) return null
      const encoded = raw.slice(0, separator)
      const presented = Buffer.from(raw.slice(separator + 1), 'base64url')
      const expected = Buffer.from(sign(encoded), 'base64url')
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
        return null
      }

      try {
        const payload = JSON.parse(
          Buffer.from(encoded, 'base64url').toString('utf8'),
        ) as Partial<SignedSessionPayload>
        if (
          payload.v !== 1 ||
          typeof payload.sid !== 'string' ||
          typeof payload.csrf !== 'string' ||
          typeof payload.org !== 'string' ||
          typeof payload.property !== 'string' ||
          typeof payload.portal !== 'string' ||
          typeof payload.issued !== 'string' ||
          typeof payload.expires !== 'string'
        ) {
          return null
        }
        const session: GuestSession = {
          sessionId: payload.sid,
          csrfNonce: payload.csrf,
          organizationId: payload.org,
          propertyId: payload.property,
          portalId: payload.portal,
          tokenVersion: 0,
          issuedAt: new Date(payload.issued),
          expiresAt: new Date(payload.expires),
          campaignMediumHint: null,
        }
        if (
          !Number.isFinite(session.issuedAt.getTime()) ||
          !Number.isFinite(session.expiresAt.getTime()) ||
          !isSessionValid(session, input.clock()) ||
          session.organizationId !== scope.organizationId ||
          session.propertyId !== scope.propertyId ||
          session.portalId !== scope.portalId
        ) {
          return null
        }
        return session
      } catch {
        return null
      }
    },

    verifyCsrf: (session, presented) => {
      const expected = createHmac('sha256', input.secret)
        .update(session.csrfNonce)
        .digest()
      const actual = createHmac('sha256', input.secret).update(presented).digest()
      return timingSafeEqual(expected, actual)
    },
  }
}
export function guestRateLimitKey(
  kind: 'rating' | 'feedback' | 'scan' | 'response' | 'media' | 'click',
  sessionId: string | null,
  ipHash: string,
): string {
  return sessionId ? `${kind}:${sessionId}` : `${kind}:ip:${ipHash}`
}

export function guestRateLimitKeys(
  kind: 'rating' | 'feedback' | 'scan' | 'response' | 'media' | 'click',
  sessionId: string | null,
  ipHash: string,
  portalId: string,
): Readonly<{ session: string; networkPortal: string }> {
  return {
    session: guestRateLimitKey(kind, sessionId, ipHash),
    networkPortal: `${kind}:network:${ipHash}:portal:${portalId}`,
  }
}

export async function checkLayeredGuestRateLimit(
  input: Readonly<{
    rateLimiter: RateLimiter
    keys: Readonly<{ session: string; networkPortal: string }>
    sessionLimits: RateLimitCheckOptions
    networkPortalLimits: RateLimitCheckOptions
  }>,
): Promise<RateLimitResult> {
  const sessionResult = await input.rateLimiter.check(
    input.keys.session,
    input.sessionLimits,
  )
  if (!sessionResult.allowed) return sessionResult
  return input.rateLimiter.check(input.keys.networkPortal, input.networkPortalLimits)
}
