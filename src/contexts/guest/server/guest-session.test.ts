// Guest context — guest session cookie helper tests
// Verifies the cookie parse/build, the server-set-on-first-contact behavior,
// and the IP-hash rate-limit fallback key used by the public write server fns.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const setResponseHeader = vi.fn()

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
}))

import {
  parseGuestSessionId,
  buildGuestSessionCookie,
  resolveGuestSession,
  guestRateLimitKey,
  GUEST_SESSION_COOKIE,
  GUEST_SESSION_MAX_AGE,
} from './guest-session'

describe('parseGuestSessionId', () => {
  it('extracts the guest_session value', () => {
    expect(parseGuestSessionId('guest_session=abc-123; other=1')).toBe('abc-123')
  })

  it('returns null when the cookie is absent', () => {
    expect(parseGuestSessionId('other=1')).toBeNull()
    expect(parseGuestSessionId('')).toBeNull()
  })

  it('returns null for an empty guest_session value', () => {
    expect(parseGuestSessionId('guest_session=;')).toBeNull()
  })
})

describe('buildGuestSessionCookie', () => {
  const cookie = buildGuestSessionCookie('abc-123')

  it('carries the cookie name and value', () => {
    expect(cookie.startsWith(`${GUEST_SESSION_COOKIE}=abc-123;`)).toBe(true)
  })

  it('is HttpOnly, SameSite=Lax, scoped to /p/, with the 24h max-age', () => {
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain(`Max-Age=${GUEST_SESSION_MAX_AGE}`)
    expect(cookie).toContain('Path=/p/')
  })
})

describe('resolveGuestSession', () => {
  beforeEach(() => setResponseHeader.mockClear())

  it('reuses the cookie session id and does not Set-Cookie when present', () => {
    const session = resolveGuestSession('guest_session=existing-id')

    expect(session).toEqual({ sessionId: 'existing-id', fromCookie: true })
    expect(setResponseHeader).not.toHaveBeenCalled()
  })

  it('mints a fresh id and sets an HttpOnly cookie when the cookie is absent', () => {
    const session = resolveGuestSession('')

    expect(session.fromCookie).toBe(false)
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(setResponseHeader).toHaveBeenCalledTimes(1)
    const [name, value] = setResponseHeader.mock.calls[0]
    expect(name).toBe('Set-Cookie')
    expect(value).toBe(buildGuestSessionCookie(session.sessionId))
    // The minted id must be stable — reusing it later sets the same cookie value.
    expect(value).toContain(`guest_session=${session.sessionId}`)
  })
})

describe('guestRateLimitKey', () => {
  it('keys on the session id when the cookie is present', () => {
    const key = guestRateLimitKey(
      'rating',
      { sessionId: 'sess-1', fromCookie: true },
      'ip-hash',
    )
    expect(key).toBe('rating:sess-1')
  })

  it('falls back to the ipHash when the request is cookieless', () => {
    const key = guestRateLimitKey(
      'feedback',
      { sessionId: 'ignored', fromCookie: false },
      'ip-hash-9',
    )
    expect(key).toBe('feedback:ip:ip-hash-9')
  })

  it('uses the requested kind prefix', () => {
    expect(guestRateLimitKey('scan', { sessionId: 's', fromCookie: true }, 'h')).toBe(
      'scan:s',
    )
  })
})
