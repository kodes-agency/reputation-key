// Integration context — domain errors tests

import { describe, it, expect } from 'vitest'
import { integrationError, isIntegrationError } from './errors'

describe('integrationError', () => {
  it('creates a tagged error with code and message', () => {
    const err = integrationError('oauth_failed', 'Token exchange failed')
    expect(err._tag).toBe('IntegrationError')
    expect(err.code).toBe('oauth_failed')
    expect(err.message).toBe('Token exchange failed')
  })

  it('creates error with each known code', () => {
    const codes = [
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
      'invalid_event',
    ] as const

    for (const code of codes) {
      const err = integrationError(code, `msg-${code}`)
      expect(err.code).toBe(code)
      expect(err._tag).toBe('IntegrationError')
    }
  })

  it('creates error with all fields matching expected shape', () => {
    const err = integrationError('forbidden', 'nope')
    expect(err._tag).toBe('IntegrationError')
    expect(err.code).toBe('forbidden')
    expect(err.message).toBe('nope')
    expect(err.recoverable).toBe(false)
  })

  it('creates recoverable error', () => {
    const err = integrationError('gbp_api_rate_limited', 'slow down', true)
    expect(err.recoverable).toBe(true)
  })

  it('returns a real Error carrying the tagged shape (ADR 0005)', () => {
    const err = integrationError('oauth_failed', 'Token exchange failed')
    expect(err).toBeInstanceOf(Error)
    expect(typeof err.stack).toBe('string')
    expect(err._tag).toBe('IntegrationError')
    // Domain identity props are enumerable so log serializers see them.
    expect(Object.keys(err)).toContain('code')
    expect(Object.keys(err)).toContain('recoverable')
  })
})

describe('isIntegrationError', () => {
  it('returns true for integration errors', () => {
    const err = integrationError('connection_not_found', 'gone')
    expect(isIntegrationError(err)).toBe(true)
  })

  it('returns false for plain objects', () => {
    expect(isIntegrationError({ _tag: 'Other' })).toBe(false)
  })

  it('returns false for a generic Error (no _tag)', () => {
    expect(isIntegrationError(new Error('nope'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isIntegrationError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isIntegrationError(undefined)).toBe(false)
  })

  it('returns false for string', () => {
    expect(isIntegrationError('IntegrationError')).toBe(false)
  })

  it('returns false for number', () => {
    expect(isIntegrationError(42)).toBe(false)
  })
})
