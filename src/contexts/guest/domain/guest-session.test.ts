import { describe, it, expect } from 'vitest'
import {
  createSession,
  isSessionValid,
  buildCookieAttributes,
  buildSetCookieHeader,
  SESSION_COOKIE_NAME,
} from './guest-session'
import { guestSessionId, organizationId, portalId, propertyId } from '#/shared/domain/ids'

describe('GuestSession', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  const baseParams = {
    sessionId: guestSessionId('sess-1'),
    csrfNonce: 'csrf-1',
    portalId: portalId('portal-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    now: NOW,
  }

  describe('createSession', () => {
    it('creates a session with default duration', () => {
      const s = createSession(baseParams)
      expect(s.sessionId).toBe('sess-1')
      expect(s.issuedAt).toEqual(NOW)
      expect(s.expiresAt.getTime()).toBeGreaterThan(s.issuedAt.getTime())
    })
  })

  describe('isSessionValid', () => {
    it('valid before expiry', () => {
      const s = createSession(baseParams)
      expect(isSessionValid(s, NOW)).toBe(true)
    })

    it('invalid after expiry', () => {
      const s = createSession(baseParams)
      expect(isSessionValid(s, new Date(s.expiresAt.getTime() + 1000))).toBe(false)
    })
  })

  describe('buildCookieAttributes', () => {
    it('sets HttpOnly and Secure on HTTPS', () => {
      const s = createSession(baseParams)
      const attrs = buildCookieAttributes(s, true)
      expect(attrs.httpOnly).toBe(true)
      expect(attrs.secure).toBe(true)
      expect(attrs.sameSite).toBe('lax')
    })

    it('does not set Secure on HTTP (dev)', () => {
      const s = createSession(baseParams)
      const attrs = buildCookieAttributes(s, false)
      expect(attrs.secure).toBe(false)
      expect(attrs.httpOnly).toBe(true)
    })
  })

  describe('buildSetCookieHeader', () => {
    it('includes all required attributes', () => {
      const s = createSession(baseParams)
      const attrs = buildCookieAttributes(s, true)
      const header = buildSetCookieHeader(attrs)
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Secure')
      expect(header).toContain('SameSite=lax')
      expect(header).toContain('Path=/p/')
    })

    it('uses the correct cookie name', () => {
      const s = createSession(baseParams)
      const attrs = buildCookieAttributes(s, true)
      const header = buildSetCookieHeader(attrs)
      expect(header).toContain(`${SESSION_COOKIE_NAME}=`)
    })
  })
})
