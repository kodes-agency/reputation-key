import { describe, expect, it } from 'vitest'
import { createGbpApiError } from './gbp-api-error'
import {
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
    const error = createGbpApiError('replyToReview', 'rate_limited', {
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
