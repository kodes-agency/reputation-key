import { describe, expect, it } from 'vitest'
import { classifyPublicationFailure } from '#/contexts/review/domain/reply-publication-workflow'
import { executorErrorToReviewApiError } from './google-review-api-errors'

describe('Google call errors at the Review boundary', () => {
  it.each([
    ['auth_failed', 'authorization_changed'],
    ['permission_denied', 'authorization_changed'],
    ['rate_limited', 'provider_rate_limited'],
    ['upstream_error', 'provider_unavailable'],
    ['parse_error', 'provider_unavailable'],
  ] as const)('maps %s to %s', (code, expected) => {
    expect(
      executorErrorToReviewApiError({
        code,
        dispatch: 'answered',
        providerStatus: 503,
        retryAfterMs: 5_000,
      }).code,
    ).toBe(expected)
  })

  it.each([400, 404])('ends a run on an answered %i', (providerStatus) => {
    const error = executorErrorToReviewApiError({
      code: 'upstream_error',
      dispatch: 'answered',
      providerStatus,
      providerErrorStatus: 'NOT_FOUND',
      retryAfterMs: 5_000,
    })
    expect(error).toMatchObject({
      code: 'provider_rejected',
      recoverable: false,
      failure: { dispatch: 'answered', providerStatus, providerErrorStatus: 'NOT_FOUND' },
    })
    expect(classifyPublicationFailure(error)).toBe('terminal_rejection')
  })

  it.each([
    ['not_sent', undefined, 'retryable'],
    ['answered', 401, 'terminal_rejection'],
    ['unknown', undefined, 'ambiguous'],
  ] as const)(
    'preserves %s evidence through the product mapping',
    (dispatch, providerStatus, outcome) => {
      const error = executorErrorToReviewApiError({
        code: 'upstream_error',
        executionCode: 'transport_error',
        dispatch,
        providerStatus,
        retryAfterMs: 5_000,
      })
      expect(error.retryAfterMs).toBe(5_000)
      expect(classifyPublicationFailure(error)).toBe(outcome)
    },
  )
})
