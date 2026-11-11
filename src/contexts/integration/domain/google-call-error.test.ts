import { describe, expect, it } from 'vitest'
import {
  createGoogleCallError,
  googleCallError,
  googleCallErrorCodeForExecution,
  googleCallErrorCodeForStatus,
} from './google-call-error'

describe('Google call errors', () => {
  it.each([
    [401, 'auth_failed'],
    [403, 'permission_denied'],
    [429, 'rate_limited'],
    [400, 'upstream_error'],
    [404, 'upstream_error'],
    [503, 'upstream_error'],
  ] as const)('classifies an answered %i as %s', (status, code) => {
    expect(googleCallErrorCodeForStatus(status)).toBe(code)
  })

  it.each([
    ['admission_denied', 'quota_exhausted', 'rate_limited'],
    ['admission_denied', 'in_flight_exhausted', 'rate_limited'],
    ['admission_denied', 'authorization_changed', 'permission_denied'],
    ['admission_denied', 'authorization_denied', 'permission_denied'],
    ['admission_denied', 'coordination_unavailable', 'upstream_error'],
    ['admission_denied', 'credential_unavailable', 'upstream_error'],
    ['malformed_request', undefined, 'parse_error'],
    ['response_too_large', undefined, 'parse_error'],
    ['transport_error', undefined, 'upstream_error'],
  ] as const)('classifies %s/%s as %s', (code, admissionCode, expected) => {
    expect(googleCallErrorCodeForExecution({ code, admissionCode })).toBe(expected)
  })

  it('preserves the most specific execution reason and positive non-dispatch evidence', () => {
    const error = createGoogleCallError('replyToReview', 'rate_limited', {
      executionCode: 'admission_denied',
      executionAdmissionCode: 'quota_exhausted',
      dispatch: 'not_sent',
      retryAfterMs: 5_000,
    })
    expect(error.code).toBe('rate_limited')
    expect(googleCallError(error)).toEqual({
      code: 'rate_limited',
      executionCode: 'quota_exhausted',
      dispatch: 'not_sent',
      providerStatus: null,
      providerErrorStatus: null,
      retryAfterMs: 5_000,
    })
  })

  it('retains an answered refusal and only its allowlisted machine status', () => {
    expect(
      googleCallError({
        code: 'permission_denied',
        dispatch: 'answered',
        providerStatus: 403,
        providerErrorStatus: 'PERMISSION_DENIED',
        retryAfterMs: 0,
        message: 'private provider content',
        body: 'private provider content',
      }),
    ).toEqual({
      code: 'permission_denied',
      executionCode: null,
      dispatch: 'answered',
      providerStatus: 403,
      providerErrorStatus: 'PERMISSION_DENIED',
      retryAfterMs: 0,
    })
  })

  it('normalizes an existing GBP error without losing evidence on a second boundary', () => {
    const error = googleCallError({
      _tag: 'GbpApiError',
      kind: 'upstream_error',
      dispatch: 'answered',
      providerStatus: 401,
      executionCode: 'admission_denied',
      executionAdmissionCode: 'coordination_unavailable',
      retryAfterMs: 5_000,
    })
    expect(error).toMatchObject({
      code: 'upstream_error',
      dispatch: 'answered',
      providerStatus: 401,
      executionCode: 'coordination_unavailable',
      retryAfterMs: 5_000,
    })
    expect(googleCallError(error)).toEqual(error)
  })

  it('does not invent dispatch evidence or retain arbitrary diagnostics', () => {
    const error = googleCallError({
      code: 'private provider content',
      executionCode: 'private provider content',
      dispatch: 'sent',
      providerStatus: 999,
      providerErrorStatus: 'private provider content',
      retryAfterMs: Number.NaN,
    })
    expect(error).toEqual({
      code: 'unclassified',
      executionCode: null,
      dispatch: 'unknown',
      providerStatus: null,
      providerErrorStatus: null,
      retryAfterMs: null,
    })
    expect(JSON.stringify(error)).not.toContain('private provider content')
    expect(googleCallError(new Error('private provider content'))).toEqual(error)
  })
})

describe('createGoogleCallError', () => {
  it('returns a real Error (ADR 0005 hybrid pattern)', () => {
    const err = createGoogleCallError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(err).toBeInstanceOf(Error)
  })

  it('captures a stack trace and uses GbpApiError as the Error name', () => {
    const err = createGoogleCallError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(typeof err.stack).toBe('string')
    // captureStackTrace(err, createGoogleCallError) hides the factory frame, so the stack
    // starts at the caller; the first line is the canonical "name: message" form.
    expect(err.stack).toContain(
      'GbpApiError: GBP API fetchAccounts failed (permission_denied)',
    )
  })

  it('sets _tag to "GbpApiError"', () => {
    const err = createGoogleCallError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(err._tag).toBe('GbpApiError')
  })

  it('retains only content-free error diagnostics', () => {
    const err = createGoogleCallError('fetchAccounts', 'rate_limited', 'Rate limited')
    expect(err.operation).toBe('fetchAccounts')
    expect(err.kind).toBe('rate_limited')
    expect(err.providerBodyBytes).toBe(12)
    expect(err.retryAfterMs).toBeNull()
    expect('body' in err).toBe(false)
    expect(JSON.stringify(err)).not.toContain('Rate limited')
  })

  it('formats message as "GBP API {operation} failed ({kind})"', () => {
    const err = createGoogleCallError('fetchAccounts', 'permission_denied', 'Forbidden')
    expect(err.message).toBe('GBP API fetchAccounts failed (permission_denied)')
  })

  it('carries the domain classification, not the raw HTTP status', () => {
    const err = createGoogleCallError(
      'updateLocation',
      'upstream_error',
      'Internal Server Error',
    )
    // No raw numeric HTTP status leaks into the domain shape (cc-errors §13 BLOCKER).
    expect('status' in err).toBe(false)
    expect(err.kind).toBe('upstream_error')
  })

  it('supports content-free retry metadata', () => {
    const err = createGoogleCallError('fetchReviews', 'rate_limited', {
      providerBodyBytes: 42,
      retryAfterMs: 5_000,
    })
    expect(err.providerBodyBytes).toBe(42)
    expect(err.retryAfterMs).toBe(5_000)
    expect(err.message).toBe('GBP API fetchReviews failed (rate_limited)')
  })

  it('treats dispatch as unknown unless an adapter proved otherwise', () => {
    // `unknown` is the conservative answer: a caller may only repeat a write on
    // positive evidence that nothing reached Google.
    const err = createGoogleCallError('fetchReviews', 'upstream_error', 'Bad Gateway')
    expect(err.dispatch).toBe('unknown')
    expect(err.executionCode).toBeUndefined()
    expect(err.providerStatus).toBeUndefined()
  })

  it('carries content-free dispatch evidence', () => {
    const err = createGoogleCallError('replyToReview', 'parse_error', {
      dispatch: 'answered',
      executionCode: 'response_too_large',
      providerStatus: 502,
    })
    expect(err).toMatchObject({
      dispatch: 'answered',
      executionCode: 'response_too_large',
      providerStatus: 502,
    })
    expect(Object.keys(err)).toEqual(
      expect.arrayContaining(['dispatch', 'executionCode', 'providerStatus']),
    )
    expect(err.message).toBe('GBP API replyToReview failed (parse_error)')
  })

  it('exposes properties as enumerable', () => {
    const err = createGoogleCallError('fetchAccounts', 'auth_failed', 'Unauthorized')
    const keys = Object.keys(err)
    expect(keys).toContain('_tag')
    expect(keys).toContain('operation')
    expect(keys).toContain('kind')
    expect(keys).toContain('providerBodyBytes')
    expect(keys).toContain('retryAfterMs')
    expect(keys).not.toContain('body')
  })
})
