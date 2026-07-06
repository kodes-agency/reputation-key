// Integration context — GBP API error tests

import { describe, it, expect } from 'vitest'
import { createGbpApiError } from './gbp-api-error'

describe('createGbpApiError', () => {
  it('returns a real Error (ADR 0005 hybrid pattern)', () => {
    const err = createGbpApiError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(err).toBeInstanceOf(Error)
  })

  it('captures a stack trace and uses GbpApiError as the Error name', () => {
    const err = createGbpApiError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(typeof err.stack).toBe('string')
    // captureStackTrace(err, createGbpApiError) hides the factory frame, so the stack
    // starts at the caller; the first line is the canonical "name: message" form.
    expect(err.stack).toContain(
      'GbpApiError: GBP API fetchAccounts failed (permission_denied)',
    )
  })

  it('sets _tag to "GbpApiError"', () => {
    const err = createGbpApiError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(err._tag).toBe('GbpApiError')
  })

  it('sets operation, kind, and body', () => {
    const err = createGbpApiError('fetchAccounts', 'rate_limited', 'Rate limited')
    expect(err.operation).toBe('fetchAccounts')
    expect(err.kind).toBe('rate_limited')
    expect(err.body).toBe('Rate limited')
  })

  it('formats message as "GBP API {operation} failed ({kind})"', () => {
    const err = createGbpApiError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(err.message).toBe('GBP API fetchAccounts failed (permission_denied)')
  })

  it('carries the domain classification, not the raw HTTP status', () => {
    const err = createGbpApiError(
      'updateLocation',
      'upstream_error',
      'Internal Server Error',
    )
    // No raw numeric HTTP status leaks into the domain shape (cc-errors §13 BLOCKER).
    expect('status' in err).toBe(false)
    expect(err.kind).toBe('upstream_error')
  })

  it('handles empty body', () => {
    const err = createGbpApiError('fetchReviews', 'parse_error', '')
    expect(err.body).toBe('')
    expect(err.message).toBe('GBP API fetchReviews failed (parse_error)')
  })

  it('exposes properties as enumerable', () => {
    const err = createGbpApiError('fetchAccounts', 'auth_failed', 'Unauthorized')
    const keys = Object.keys(err)
    expect(keys).toContain('_tag')
    expect(keys).toContain('operation')
    expect(keys).toContain('kind')
    expect(keys).toContain('body')
  })
})
