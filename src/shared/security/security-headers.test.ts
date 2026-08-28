// Tests for security headers (B0.7).

import { afterEach, describe, it, expect, vi } from 'vitest'
import { getSecurityHeaders, applySecurityHeaders } from './security-headers'

afterEach(() => {
  vi.unstubAllEnvs()
})
describe('getSecurityHeaders', () => {
  it('returns restrictive CSP', () => {
    const headers = getSecurityHeaders({ isProduction: false })
    const csp = headers['Content-Security-Policy']
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("manifest-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it('authorizes a per-response script nonce and the declared font origins', () => {
    const csp = getSecurityHeaders({
      isProduction: false,
      cspNonce: 'bqc-csp-nonce',
    })['Content-Security-Policy']

    expect(csp).toContain("script-src 'self' 'nonce-bqc-csp-nonce'")
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
    )
    expect(csp).toContain(
      "font-src 'self' https://cdn.fontshare.com https://fonts.gstatic.com",
    )
  })

  it('allows only the configured browser-upload origin for connections', () => {
    vi.stubEnv('S3_PRESIGN_ENDPOINT', 'http://127.0.0.1:4900/storage/path')
    const csp = getSecurityHeaders({ isProduction: false })['Content-Security-Policy']

    expect(csp).toContain("connect-src 'self' http://127.0.0.1:4900")
    expect(csp).not.toContain('/storage/path')
  })

  it('rejects a configured upload source that could alter CSP syntax', () => {
    expect(() =>
      getSecurityHeaders({
        isProduction: false,
        connectSources: ["https://storage.example.com'; connect-src *"],
      }),
    ).toThrow('CSP connect source')
  })

  it('rejects a nonce that could alter the CSP syntax', () => {
    expect(() =>
      getSecurityHeaders({
        isProduction: false,
        cspNonce: "valid' ; script-src *",
      }),
    ).toThrow('CSP nonce')
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
