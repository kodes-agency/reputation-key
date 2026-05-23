// Integration context — shared server helpers tests
// Tests the error→status mapping and throwContextError construction used by
// the integration server functions. Imports the real integrationErrorStatus
// from the server module to ensure tests break when production code changes.
//
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { integrationErrorStatus } from './shared'
import { integrationError } from '../domain/errors'
import type { IntegrationErrorCode } from '../domain/errors'
import { throwContextError } from '#/shared/auth/server-errors'

// ── Error → HTTP status mapping (production code) ─────────────────

describe('integrationErrorStatus (imported from server module)', () => {
  it('maps forbidden → 403', () => {
    expect(integrationErrorStatus('forbidden')).toBe(403)
  })

  it('maps connection_not_found → 404', () => {
    expect(integrationErrorStatus('connection_not_found')).toBe(404)
  })

  it('maps import_not_found → 404', () => {
    expect(integrationErrorStatus('import_not_found')).toBe(404)
  })

  it('maps oauth_failed → 400', () => {
    expect(integrationErrorStatus('oauth_failed')).toBe(400)
  })

  it('maps oauth_denied → 400', () => {
    expect(integrationErrorStatus('oauth_denied')).toBe(400)
  })

  it('maps token_refresh_failed → 400', () => {
    expect(integrationErrorStatus('token_refresh_failed')).toBe(400)
  })

  it('maps gbp_api_error → 400', () => {
    expect(integrationErrorStatus('gbp_api_error')).toBe(400)
  })

  it('maps invalid_visibility → 400', () => {
    expect(integrationErrorStatus('invalid_visibility')).toBe(400)
  })

  it('maps encryption_error → 400', () => {
    expect(integrationErrorStatus('encryption_error')).toBe(400)
  })

  it('maps gbp_api_rate_limited → 429', () => {
    expect(integrationErrorStatus('gbp_api_rate_limited')).toBe(429)
  })

  it('maps connection_disconnected → 409', () => {
    expect(integrationErrorStatus('connection_disconnected')).toBe(409)
  })

  it('all error codes are covered (exhaustive check)', () => {
    const codes: IntegrationErrorCode[] = [
      'forbidden',
      'connection_not_found',
      'connection_disconnected',
      'oauth_failed',
      'oauth_denied',
      'token_refresh_failed',
      'gbp_api_error',
      'gbp_api_rate_limited',
      'import_not_found',
      'invalid_visibility',
      'encryption_error',
      'invalid_cache_entry',
    ]
    for (const code of codes) {
      const status = integrationErrorStatus(code)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
    }
  })
})

// ── throwContextError (shared server error helper) ─────────────────

describe('throwContextError with IntegrationError', () => {
  it('throws an Error with the domain message', () => {
    const e = integrationError('oauth_failed', 'OAuth flow failed')
    expect(() =>
      throwContextError('IntegrationError', e, integrationErrorStatus(e.code)),
    ).toThrow('OAuth flow failed')
  })

  it('sets error.name to IntegrationError', () => {
    const e = integrationError('forbidden', 'Insufficient role')
    try {
      throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('IntegrationError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = integrationError('connection_not_found', 'Connection missing')
    try {
      throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('connection_not_found')
      expect(error.status).toBe(404)
    }
  })

  it('preserves the correct status for every error code', () => {
    const cases: Array<[IntegrationErrorCode, number]> = [
      ['forbidden', 403],
      ['connection_not_found', 404],
      ['import_not_found', 404],
      ['oauth_failed', 400],
      ['oauth_denied', 400],
      ['token_refresh_failed', 400],
      ['gbp_api_error', 400],
      ['invalid_visibility', 400],
      ['encryption_error', 400],
      ['invalid_cache_entry', 400],
      ['gbp_api_rate_limited', 429],
      ['connection_disconnected', 409],
    ]
    for (const [code, expectedStatus] of cases) {
      const e = integrationError(code, `test ${code}`)
      try {
        throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})
