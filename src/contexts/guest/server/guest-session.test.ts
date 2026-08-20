import { describe, expect, it } from 'vitest'
import { createGuestSessionManager, guestRateLimitKey } from './guest-session'

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
    expect(issued.cookies).toHaveLength(2)
    expect(issued.cookies[0]).toContain('rk_guest_session=')
    expect(issued.cookies[0]).toContain('HttpOnly')
    expect(issued.cookies[0]).toContain('Secure')
    expect(issued.cookies[0]).toContain('SameSite=lax')
    expect(issued.cookies[0]).toContain('Path=/p/')
    expect(issued.cookies[1]).toContain('Path=/_serverFn/')
    expect(issued.session.csrfNonce).not.toBe(issued.session.sessionId)
  })

  it('verifies scope and rejects tampering without enumeration', () => {
    const codec = manager()
    const issued = codec.issue(scope)
    const cookieHeader = issued.cookies[0].split(';')[0]
    expect(codec.verify(cookieHeader, scope)?.sessionId).toBe(issued.session.sessionId)
    expect(codec.verify(cookieHeader, { ...scope, organizationId: 'org-2' })).toBeNull()
    expect(codec.verify(`${cookieHeader}x`, scope)).toBeNull()
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
})

describe('guestRateLimitKey', () => {
  it('uses the verified session and otherwise the network hash', () => {
    expect(guestRateLimitKey('response', 'session-1', 'ip-hash')).toBe(
      'response:session-1',
    )
    expect(guestRateLimitKey('response', null, 'ip-hash')).toBe('response:ip:ip-hash')
  })
})
