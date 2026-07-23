import { describe, it, expect } from 'vitest'
import {
  createSession,
  isSessionValid,
  buildCookieAttributes,
  buildSetCookieHeader,
  buildClearCookieHeader,
  SESSION_COOKIE_NAME,
} from './guest-session'

describe('GuestSession', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  const baseParams = {
    sessionId: 'sess-1',
    portalId: 'portal-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    tokenVersion: 1,
    now: NOW,
  }

  describe('createSession', () => {
    it('creates a session with default duration', () => {
      const s = createSession(baseParams)
      expect(s.sessionId).toBe('sess-1')
      expect(s.issuedAt).toEqual(NOW)
      expect(s.expiresAt.getTime()).toBeGreaterThan(s.issuedAt.getTime())
      expect(s.campaignMediumHint).toBeNull()
    })

    it('accepts campaign medium hint', () => {
      const s = createSession({ ...baseParams, campaignMediumHint: 'qr' })
      expect(s.campaignMediumHint).toBe('qr')
    })
  })

  describe('isSessionValid', () => {
    it('valid before expiry', () => {
      const s = createSession(baseParams)
      expect(isSessionValid(s, NOW)).toBe(true)
    })

    it('invalid after expiry', () => {
      const s = createSession({ ...baseParams, durationMs: 0 })
      // Session with 0 duration expires immediately
      expect(isSessionValid(s, new Date(NOW.getTime() + 1000))).toBe(false)
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
      expect(header).toContain(`Path=/`)
    })

    it('uses the correct cookie name', () => {
      const s = createSession(baseParams)
      const attrs = buildCookieAttributes(s, true)
      const header = buildSetCookieHeader(attrs)
      expect(header).toContain(`${SESSION_COOKIE_NAME}=`)
    })
  })

  describe('buildClearCookieHeader', () => {
    it('clears cookie with Max-Age=0', () => {
      const header = buildClearCookieHeader(true)
      expect(header).toContain('Max-Age=0')
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Secure')
    })
  })
})
