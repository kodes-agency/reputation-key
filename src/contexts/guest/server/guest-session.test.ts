import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  checkLayeredGuestRateLimit,
  createGuestSessionManager,
  guestRateLimitKey,
  guestRateLimitKeys,
} from './guest-session'

const scope = {
  organizationId: 'org-1',
  propertyId: '00000000-0000-4000-8000-000000000001',
  portalId: '00000000-0000-4000-8000-000000000002',
}

function manager(now = new Date('2026-08-09T12:00:00Z')) {
  let sequence = 1
  return createGuestSessionManager({
    secret: '0123456789abcdef0123456789abcdef',
    secureCookies: true,
    clock: () => now,
    randomId: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
  })
}

describe('signed guest session', () => {
  it('issues a signed HttpOnly cookie and returns only the CSRF nonce to UI', () => {
    const issued = manager().issue(scope)
    expect(issued.cookies).toHaveLength(3)
    expect(issued.cookies[0]).toContain('rk_guest_session=')
    expect(issued.cookies[0]).toContain('HttpOnly')
    expect(issued.cookies[0]).toContain('Secure')
    expect(issued.cookies[0]).toContain('SameSite=lax')
    expect(issued.cookies[0]).toContain('Path=/p/')
    expect(issued.cookies[1]).toContain('Path=/_serverFn/')
    expect(issued.cookies[2]).toContain('Path=/api/public/p/')
    expect(issued.session.csrfNonce).not.toBe(issued.session.sessionId)
  })

  it('verifies scope and rejects tampering without enumeration', () => {
    const codec = manager()
    const issued = codec.issue(scope, 'bg')
    const cookieHeader = issued.cookies[0].split(';')[0]
    expect(codec.verify(cookieHeader, scope)?.sessionId).toBe(issued.session.sessionId)
    expect(codec.verify(cookieHeader, scope)?.guestLocale).toBe('bg')
    expect(codec.verify(cookieHeader, { ...scope, organizationId: 'org-2' })).toBeNull()
    expect(codec.verify(`${cookieHeader}x`, scope)).toBeNull()
  })

  describe('a cookie signed before the catalogue widened', () => {
    const secret = '0123456789abcdef0123456789abcdef'
    const now = new Date('2026-08-09T12:00:00Z')
    const codec = createGuestSessionManager({
      secret,
      secureCookies: true,
      clock: () => now,
      randomId: () => crypto.randomUUID(),
    })

    function cookieWithLocale(locale: string | undefined): string {
      const payload = {
        v: 1,
        sid: '00000000-0000-4000-8000-000000000009',
        csrf: 'csrf-nonce',
        org: scope.organizationId,
        property: scope.propertyId,
        portal: scope.portalId,
        issued: now.toISOString(),
        expires: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        ...(locale === undefined ? {} : { locale }),
      }
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
      return `rk_guest_session=${encodeURIComponent(`${encoded}.${signature}`)}`
    }

    it('still verifies with its bg or en locale', () => {
      expect(codec.verify(cookieWithLocale('bg'), scope)?.guestLocale).toBe('bg')
      expect(codec.verify(cookieWithLocale('en'), scope)?.guestLocale).toBe('en')
    })

    it('verifies with no locale at all', () => {
      expect(codec.verify(cookieWithLocale(undefined), scope)?.guestLocale).toBeNull()
    })

    it('reads a locale outside the catalogue as no choice, not as English', () => {
      expect(codec.verify(cookieWithLocale('pt'), scope)?.guestLocale).toBeNull()
    })
  })

  it('re-signs the same scoped identity when the guest explicitly selects a locale', () => {
    const codec = manager()
    const issued = codec.issue(scope, 'en')
    const selected = codec.selectLocale(issued.session, 'bg')

    expect(selected.session).toMatchObject({
      sessionId: issued.session.sessionId,
      csrfNonce: issued.session.csrfNonce,
      guestLocale: 'bg',
      expiresAt: issued.session.expiresAt,
    })
    expect(codec.verify(selected.cookies[0].split(';')[0], scope)?.guestLocale).toBe('bg')
  })

  it('does not authenticate an expired cookie', () => {
    let now = new Date('2026-08-09T12:00:00Z')
    const codec = createGuestSessionManager({
      secret: '0123456789abcdef0123456789abcdef',
      secureCookies: false,
      clock: () => now,
      randomId: () => crypto.randomUUID(),
    })
    const issued = codec.issue(scope)
    now = new Date('2026-08-10T12:00:01Z')
    expect(codec.verify(issued.cookies[0].split(';')[0], scope)).toBeNull()
  })

  describe('dropped response receipts', () => {
    it.each([1, 5])(
      'recovers a signed rating of %i until the response deadline',
      (rating) => {
        const codec = manager()
        const issued = codec.issue(scope, 'bg')
        const submittedAt = new Date('2026-08-09T13:00:00Z')
        const remembered = codec.rememberDroppedResponse(
          issued.session,
          rating,
          submittedAt,
        )
        const cookieHeader = remembered.cookies[0].split(';')[0] ?? ''

        expect(codec.verify(cookieHeader, scope)).toMatchObject({
          sessionId: issued.session.sessionId,
          csrfNonce: issued.session.csrfNonce,
          guestLocale: 'bg',
          expiresAt: new Date('2026-08-10T13:00:00Z'),
          droppedResponse: { rating, submittedAt: submittedAt.toISOString() },
        })
        expect(
          codec.verify(cookieHeader, {
            ...scope,
            portalId: 'other',
          }),
        ).toBeNull()
        expect(
          manager(new Date('2026-08-10T13:00:00Z')).verify(cookieHeader, scope),
        ).toBeNull()
      },
    )

    it.each([
      { rating: 0, submittedAt: '2026-08-09T12:00:00Z' },
      { rating: 6, submittedAt: '2026-08-09T12:00:00Z' },
      { rating: 1.5, submittedAt: '2026-08-09T12:00:00Z' },
      { rating: '5', submittedAt: '2026-08-09T12:00:00Z' },
      { rating: 5, submittedAt: 'invalid' },
      { rating: 5 },
      null,
    ])(
      'ignores an invalid optional receipt %j while preserving the signed session',
      (dropped) => {
        const codec = manager()
        const issued = codec.issue(scope)
        const encodedSession = issued.cookies[0].split('=')[1]?.split('.')[0] ?? ''
        const payload = JSON.parse(
          Buffer.from(encodedSession, 'base64url').toString('utf8'),
        )
        const encoded = Buffer.from(JSON.stringify({ ...payload, dropped })).toString(
          'base64url',
        )
        const signature = createHmac('sha256', '0123456789abcdef0123456789abcdef')
          .update(encoded)
          .digest('base64url')
        const verified = codec.verify(`rk_guest_session=${encoded}.${signature}`, scope)

        expect(verified?.sessionId).toBe(issued.session.sessionId)
        expect(verified?.droppedResponse).toBeUndefined()
      },
    )
  })

  it('re-signs the same recovery identity only until the domain deadline', () => {
    let now = new Date('2026-08-09T12:00:00Z')
    const codec = createGuestSessionManager({
      secret: '0123456789abcdef0123456789abcdef',
      secureCookies: true,
      clock: () => now,
      randomId: () => crypto.randomUUID(),
    })
    const issued = codec.issue(scope)
    now = new Date('2026-08-09T23:00:00Z')
    const deadline = new Date('2026-08-10T23:00:00Z')
    const renewed = codec.renewUntil(issued.session, deadline)

    expect(renewed?.session).toMatchObject({
      sessionId: issued.session.sessionId,
      csrfNonce: issued.session.csrfNonce,
      issuedAt: now,
      expiresAt: deadline,
    })
    expect(codec.verify(renewed!.cookies[0].split(';')[0], scope)?.expiresAt).toEqual(
      deadline,
    )
    expect(
      codec.renewUntil(issued.session, new Date('2026-08-10T23:00:00.001Z')),
    ).toBeNull()
    expect(codec.renewUntil(issued.session, now)).toBeNull()
  })
})

describe('guestRateLimitKey', () => {
  it('uses the verified session and otherwise the network hash', () => {
    expect(guestRateLimitKey('response', 'session-1', 'ip-hash')).toBe(
      'response:session-1',
    )
    expect(guestRateLimitKey('response', null, 'ip-hash')).toBe('response:ip:ip-hash')
  })

  it('always includes a network-and-Portal layer alongside a session layer', () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#1
    expect(guestRateLimitKeys('scan', 'session-1', 'ip-hash', 'portal-1')).toEqual({
      session: 'scan:session-1',
      networkPortal: 'scan:network:ip-hash:portal:portal-1',
    })
  })

  it('supports a per-link session anchor without weakening the network layer', () => {
    expect(
      guestRateLimitKeys('click', 'session-1:link-1', 'ip-hash', 'portal-1'),
    ).toEqual({
      session: 'click:session-1:link-1',
      networkPortal: 'click:network:ip-hash:portal:portal-1',
    })
  })

  it('checks both layers and stops immediately when either layer denies', async () => {
    const allowed = {
      allowed: true,
      remaining: 1,
      resetAt: new Date('2026-08-09T13:00:00Z'),
      backendStatus: 'available' as const,
    }
    const denied = { ...allowed, allowed: false, remaining: 0 }
    const check = vi.fn().mockResolvedValueOnce(allowed).mockResolvedValueOnce(denied)

    await expect(
      checkLayeredGuestRateLimit({
        rateLimiter: { check },
        keys: guestRateLimitKeys('scan', 'session-1', 'ip-hash', 'portal-1'),
        sessionLimits: { maxRequests: 2, windowSeconds: 3600 },
        networkPortalLimits: { maxRequests: 10, windowSeconds: 3600 },
      }),
    ).resolves.toEqual({ ...denied, layer: 'networkPortal' })
    expect(check.mock.calls).toEqual([
      ['scan:session-1', { maxRequests: 2, windowSeconds: 3600 }],
      ['scan:network:ip-hash:portal:portal-1', { maxRequests: 10, windowSeconds: 3600 }],
    ])
  })

  it('names the session layer when a device, not a venue, is out of budget', async () => {
    const denied = {
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-08-09T13:00:00Z'),
      backendStatus: 'available' as const,
    }
    const check = vi.fn().mockResolvedValueOnce(denied)

    await expect(
      checkLayeredGuestRateLimit({
        rateLimiter: { check },
        keys: guestRateLimitKeys('scan', 'session-1', 'ip-hash', 'portal-1'),
        sessionLimits: { maxRequests: 2, windowSeconds: 3600 },
        networkPortalLimits: { maxRequests: 10, windowSeconds: 3600 },
      }),
    ).resolves.toEqual({ ...denied, layer: 'session' })
    expect(check).toHaveBeenCalledTimes(1)
  })
})
