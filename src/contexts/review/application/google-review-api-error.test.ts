import { describe, expect, it, vi } from 'vitest'
import { classifyPublicationFailure } from '#/contexts/review/domain/reply-publication-workflow'
import {
  executorErrorToReviewApiError,
  reviewApiError,
  translatedGoogleReviewApi,
} from './google-review-api-error'

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

  it.each([400, 404])(
    'retries an incomplete response with HTTP %i instead of parking the snapshot',
    (providerStatus) => {
      const error = executorErrorToReviewApiError({
        code: 'upstream_error',
        executionCode: 'response_too_large',
        dispatch: 'answered',
        providerStatus,
        retryAfterMs: 5_000,
      })

      expect(error).toMatchObject({
        code: 'provider_unavailable',
        recoverable: true,
        retryAfterMs: 5_000,
        failure: {
          executionCode: 'response_too_large',
          dispatch: 'answered',
          providerStatus,
        },
      })
    },
  )

  it('drops arbitrary provider content at the Review boundary', () => {
    const error = executorErrorToReviewApiError({
      code: 'upstream_error',
      dispatch: 'answered',
      providerStatus: 404,
      providerErrorStatus: 'PRIVATE_CUSTOMER_VALUE',
      message: 'private customer content',
      body: { error: { status: 'NOT_FOUND', message: 'private resource' } },
    })

    expect(error).toMatchObject({
      code: 'provider_rejected',
      failure: {
        executionCode: null,
        dispatch: 'answered',
        providerStatus: 404,
        providerErrorStatus: null,
      },
    })
    expect(`${error.message} ${JSON.stringify(error)}`).not.toMatch(/private/iu)
  })
})

describe('messages that reach the queue failure reason', () => {
  it.each([
    [
      { code: 'rate_limited', dispatch: 'answered', providerStatus: 429 },
      'Google review API request failed (rate_limited; answered; status 429)',
    ],
    [
      { code: 'upstream_error', dispatch: 'not_sent', executionCode: 'transport_error' },
      'Google review API request failed (transport_error; not_sent)',
    ],
    [
      { code: 'permission_denied', dispatch: 'answered', providerStatus: 403 },
      'Google review API request failed (permission_denied; answered; status 403)',
    ],
    [{}, 'Google review API request failed (unclassified; unknown)'],
  ])('words %j as %s', (failure, message) => {
    expect(executorErrorToReviewApiError(failure).message).toBe(message)
  })

  it('words an error with no evidence plainly', () => {
    expect(reviewApiError('malformed_response', false).message).toBe(
      'Google review API request failed',
    )
  })

  it('gives a retried code the provider floor when Google sent no hint', () => {
    expect(executorErrorToReviewApiError({ code: 'upstream_error' }).retryAfterMs).toBe(
      reviewApiError('provider_unavailable', true).retryAfterMs,
    )
  })
})

describe('translatedGoogleReviewApi', () => {
  const providerFailure = {
    _tag: 'GbpApiError',
    kind: 'rate_limited',
    dispatch: 'answered',
    providerStatus: 429,
    retryAfterMs: 2_000,
  }

  it('translates a provider failure of a read into the Review error', async () => {
    const port = { getReview: vi.fn().mockRejectedValue(providerFailure) }
    await expect(translatedGoogleReviewApi(port).getReview()).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'provider_rate_limited',
      recoverable: true,
      retryAfterMs: 2_000,
    })
  })

  it.each([
    ['a Review error', reviewApiError('cursor_expired', false)],
    [
      'an unusable connection',
      Object.assign(new Error('x'), { code: 'connection_unusable' }),
    ],
    [
      'a refused authorizer',
      Object.assign(new Error('x'), { code: 'authorization_denied' }),
    ],
  ])('keeps %s as it was', async (_label, error) => {
    const port = { readReviewsHead: vi.fn().mockRejectedValue(error) }
    await expect(translatedGoogleReviewApi(port).readReviewsHead()).rejects.toBe(error)
  })

  it('passes results through and translates the same port once', async () => {
    const port = { listReviewsPage: vi.fn().mockResolvedValue({ reviews: [] }) }
    expect(translatedGoogleReviewApi(port)).toBe(translatedGoogleReviewApi(port))
    await expect(translatedGoogleReviewApi(port).listReviewsPage()).resolves.toEqual({
      reviews: [],
    })
  })
})
