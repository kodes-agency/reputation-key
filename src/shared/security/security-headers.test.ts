// Tests for security headers (B0.7).

import { describe, it, expect } from 'vitest'
import { getSecurityHeaders, applySecurityHeaders } from './security-headers'

describe('getSecurityHeaders', () => {
  it('returns restrictive CSP', () => {
    const headers = getSecurityHeaders({ isProduction: false })
    const csp = headers['Content-Security-Policy']
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it('includes HSTS only in production', () => {
    const prodHeaders = getSecurityHeaders({ isProduction: true })
    const devHeaders = getSecurityHeaders({ isProduction: false })
    expect(prodHeaders['Strict-Transport-Security']).toBeDefined()
    expect(devHeaders['Strict-Transport-Security']).toBeUndefined()
  })

  it('sets X-Content-Type-Options nosniff', () => {
    const headers = getSecurityHeaders({ isProduction: false })
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('sets X-Frame-Options DENY', () => {
    const headers = getSecurityHeaders({ isProduction: false })
    expect(headers['X-Frame-Options']).toBe('DENY')
  })

  it('sets Referrer-Policy', () => {
    const headers = getSecurityHeaders({ isProduction: false })
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  it('sets Permissions-Policy restricting camera/mic/geo', () => {
    const headers = getSecurityHeaders({ isProduction: false })
    expect(headers['Permissions-Policy']).toContain('camera=()')
    expect(headers['Permissions-Policy']).toContain('microphone=()')
    expect(headers['Permissions-Policy']).toContain('geolocation=()')
  })
})

describe('applySecurityHeaders', () => {
  it('sets headers on a Headers object', () => {
    const h = new Headers()
    applySecurityHeaders(h, { isProduction: false })
    expect(h.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('does not overwrite caller-set values', () => {
    const h = new Headers()
    h.set('X-Frame-Options', 'SAMEORIGIN')
    applySecurityHeaders(h, { isProduction: false })
    expect(h.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })
})
