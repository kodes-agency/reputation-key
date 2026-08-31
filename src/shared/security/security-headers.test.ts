// Tests for security headers (B0.7).

import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  getSecurityHeaders,
  applySecurityHeaders,
  storageConnectSources,
} from './security-headers'

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

// ARC-03-T14: the header builder takes configuration explicitly. The parity
// cases below use the same values the ambient reads used to produce, so the
// output is provably unchanged for a given configuration.
describe('explicit configuration (ARC-03-T14)', () => {
  it('derives the presign endpoint origin when one is configured', () => {
    expect(
      storageConnectSources({ S3_PRESIGN_ENDPOINT: 'https://presign.example' }),
    ).toEqual(['https://presign.example'])
  })

  it('derives the virtual-hosted bucket origin from bucket + region', () => {
    expect(
      storageConnectSources({ AWS_S3_BUCKET_NAME: 'assets', AWS_S3_REGION: 'us-east-1' }),
    ).toEqual(['https://assets.s3.us-east-1.amazonaws.com'])
  })

  it('derives the path-style origin when path style is enabled', () => {
    expect(
      storageConnectSources({
        AWS_S3_BUCKET_NAME: 'assets',
        AWS_S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: 'true',
      }),
    ).toEqual(['https://s3.us-east-1.amazonaws.com'])
  })

  it('derives nothing from an incomplete configuration rather than guessing', () => {
    expect(storageConnectSources({ AWS_S3_BUCKET_NAME: 'assets' })).toEqual([])
    expect(storageConnectSources({})).toEqual([])
  })

  it('takes production posture from the supplied environment', () => {
    const production = getSecurityHeaders({ env: { NODE_ENV: 'production' } })
    const development = getSecurityHeaders({ env: { NODE_ENV: 'development' } })

    expect(production['Strict-Transport-Security']).toBeDefined()
    expect(development['Strict-Transport-Security']).toBeUndefined()
  })

  it('produces the same CSP from an explicit env as from equivalent connectSources', () => {
    const explicitEnv = getSecurityHeaders({
      isProduction: false,
      env: { AWS_S3_BUCKET_NAME: 'assets', AWS_S3_REGION: 'us-east-1' },
    })
    const explicitSources = getSecurityHeaders({
      isProduction: false,
      connectSources: ['https://assets.s3.us-east-1.amazonaws.com'],
    })

    expect(explicitEnv['Content-Security-Policy']).toBe(
      explicitSources['Content-Security-Policy'],
    )
  })
})
