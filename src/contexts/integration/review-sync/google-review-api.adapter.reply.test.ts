import { classifyPublicationFailure } from '#/contexts/reputation/domain/reply-publication-workflow'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '../../../../test-fixtures/generated/google-provider-identifiers-v1'
import {
  CONNECTION_ID,
  ORG_ID,
  PROPERTY_ID,
  answered,
  byTitle,
  connection,
  createAdapter,
  cursorStore,
  jsonAnswer,
  publicationAuthorization,
  publicationInput,
  refused,
  settledError,
} from '#/shared/testing/google-review-api-adapter.test-fixtures'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter.server'

describe('GoogleReviewApiAdapter', () => {
  it('uses only the attempt-bound publication permit for a governed reply write', async () => {
    const execute = jsonAnswer(
      {},
      {
        contentType: 'application/json',
        headers: { providerCorrelationId: 'provider-request-1' },
      },
    )
    const { api, authorizeProviderCall, authorizeReplyPublicationProviderCall } =
      createAdapter({ execute })

    await expect(api.replyToReview(publicationInput())).resolves.toEqual({
      providerCorrelationId: 'provider-request-1',
    })
    expect(authorizeProviderCall).not.toHaveBeenCalled()
    expect(authorizeReplyPublicationProviderCall).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      sourceEpoch: 17,
      reviewId: publicationAuthorization.publication.reviewId,
      materialReviewRevision: 4,
      replyId: publicationAuthorization.publication.replyId,
      publicationCycle: 2,
      attemptNumber: 1,
    })
    expect(execute).toHaveBeenCalledWith(
      {
        routeKey: 'reviews.reply',
        accessToken: 'access-token',
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
        comment: 'thanks',
      },
      expect.objectContaining({ authorization: publicationAuthorization }),
    )
  })

  it('fails closed before credential/provider access when publication authority is absent', async () => {
    const execute = vi.fn()
    const api = createGoogleReviewApiAdapter({
      connectionRepo: { findById: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      cursorStore: cursorStore(),
      executor: { execute },
    })
    await expect(api.replyToReview(publicationInput())).rejects.toMatchObject({
      _tag: 'GbpApiError',
      code: 'upstream_error',
      dispatch: 'unknown',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects text that does not match the durable publication digest', async () => {
    const execute = vi.fn()
    const { api } = createAdapter({ execute })

    await expect(
      api.replyToReview({ ...publicationInput(), text: 'different reply' }),
    ).rejects.toMatchObject({ code: 'authorization_changed', recoverable: false })
    expect(execute).not.toHaveBeenCalled()
  })
})

// A reply cannot be published until an AccountAdmin reconnects Google. The
// publish job has to learn that, not that the approval binding changed, or the
// author is told Google rejected the reply and to retry it.
describe('GoogleReviewApiAdapter reply while Google needs reconnecting', () => {
  const waitingForConsent = { ...connection, status: 'reauth_required' }

  it('reports reauthorization_required when publication authority is refused for that reason', async () => {
    const execute = vi.fn()
    const { api } = createAdapter({
      execute,
      authorizeReplyPublicationProviderCall: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Google reply publication authorization is unavailable: runtime_unavailable',
          ),
        ),
      findById: vi.fn().mockResolvedValue(waitingForConsent),
    })

    await expect(api.replyToReview(publicationInput())).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'reauthorization_required',
      recoverable: false,
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports the answered 401 of a revoked grant as reauthorization_required', async () => {
    const execute = answered(401, { body: '' })
    const { api } = createAdapter({
      execute,
      findById: vi.fn().mockResolvedValue(waitingForConsent),
    })

    await expect(api.replyToReview(publicationInput())).rejects.toMatchObject({
      code: 'reauthorization_required',
      recoverable: false,
      failure: { dispatch: 'answered', providerStatus: 401 },
    })
  })

  it('keeps authorization_changed while the connection is still usable', async () => {
    const { api } = createAdapter({
      execute: vi.fn(),
      authorizeReplyPublicationProviderCall: vi
        .fn()
        .mockRejectedValue(new Error('authorization vector changed')),
    })

    await expect(api.replyToReview(publicationInput())).rejects.toMatchObject({
      code: 'authorization_changed',
    })
  })

  it('keeps authorization_changed when the connection cannot be read', async () => {
    const { api } = createAdapter({
      execute: vi.fn(),
      authorizeReplyPublicationProviderCall: vi
        .fn()
        .mockRejectedValue(new Error('authorization vector changed')),
      findById: vi.fn().mockRejectedValue(new Error('database unavailable')),
    })

    await expect(api.replyToReview(publicationInput())).rejects.toMatchObject({
      code: 'authorization_changed',
    })
  })
})

// D2: the incident reply was refused by the executor's compile step with no
// permit and no fetch, but `executorErrorToReviewApiError` dropped the code and
// the dispatch, so the publish job read it as ambiguous. The review error now
// carries the dispatch the provider plane recorded, and a content-free message
// that reaches BullMQ's `failedReason`.
describe('GoogleReviewApiAdapter reply failure evidence (D2)', () => {
  const REPLY_TEXT = 'Thank you, Maria.\nSee you again soon!'

  function replyAdapter(execute: Mock) {
    return createAdapter({
      execute,
      authorizeReplyPublicationProviderCall: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        authorization: {
          ...publicationAuthorization,
          authorizationVector: {
            ...publicationAuthorization.authorizationVector,
            expectedReplyDigest: googleReplyTextDigest(REPLY_TEXT),
          },
        },
      }),
    }).api
  }

  const replyInput = () => ({ ...publicationInput(), text: REPLY_TEXT })

  // Each row is one executor result for the reply write: the review error must
  // carry that evidence, and nothing of the reply text or the provider body.
  it.each(
    byTitle([
      {
        title:
          'carries a compile refusal as not_sent malformed_request with no reply text',
        execute: refused('malformed_request'),
        match: {
          _tag: 'GoogleReviewApiError',
          failure: {
            executionCode: 'malformed_request',
            dispatch: 'not_sent',
            providerStatus: null,
          },
        },
        message: 'Google review API request failed (malformed_request; not_sent)',
        leaks: ['Maria'],
      },
      {
        title: 'names the admission code when the gateway refused before dispatch',
        execute: refused('admission_denied', {
          admissionCode: 'coordination_unavailable',
        }),
        match: {
          code: 'provider_unavailable',
          failure: {
            executionCode: 'coordination_unavailable',
            dispatch: 'not_sent',
            providerStatus: null,
          },
        },
        message: 'Google review API request failed (coordination_unavailable; not_sent)',
        leaks: [],
      },
      {
        title: 'carries the answered status of a provider error response',
        execute: answered(503, { body: '{"error":{"message":"backend error"}}' }),
        match: {
          code: 'provider_unavailable',
          failure: { executionCode: null, dispatch: 'answered', providerStatus: 503 },
        },
        message:
          'Google review API request failed (upstream_error; answered; status 503)',
        leaks: ['backend error'],
      },
      {
        title: 'carries only the allowlisted machine status through the review API error',
        execute: answered(404, {
          body: JSON.stringify({
            error: {
              status: 'NOT_FOUND',
              message: 'private content',
              details: [{ name: 'private resource' }],
            },
          }),
        }),
        match: {
          code: 'provider_rejected',
          failure: {
            providerStatus: 404,
            providerErrorStatus: 'NOT_FOUND',
            dispatch: 'answered',
          },
        },
        message:
          'Google review API request failed (upstream_error; answered; status 404)',
        leaks: ['private'],
      },
      {
        title: 'keeps the rate-limit hint alongside the answered 429',
        execute: answered(429, { retryAfter: '7', body: '' }),
        match: {
          code: 'provider_rate_limited',
          retryAfterMs: expect.any(Number),
          failure: { dispatch: 'answered', providerStatus: 429 },
        },
        message: expect.any(String),
        leaks: [],
      },
      {
        title: 'reports an executor that threw as an unknown dispatch',
        execute: vi.fn().mockRejectedValue(new Error('socket reset')),
        match: {
          code: 'provider_unavailable',
          failure: { dispatch: 'unknown', providerStatus: null },
        },
        message: expect.any(String),
        leaks: ['socket reset'],
      },
      {
        title:
          'does not read an oversized 200 answer from the gateway as an accepted write',
        execute: refused('response_too_large', {
          dispatch: 'answered',
          providerStatus: 200,
        }),
        match: {
          code: 'provider_unavailable',
          failure: {
            executionCode: 'response_too_large',
            dispatch: 'answered',
            providerStatus: 200,
          },
        },
        message:
          'Google review API request failed (response_too_large; answered; status 200)',
        leaks: [],
      },
    ]),
  )('%s', async (_title, { execute, match, message, leaks }) => {
    const error = await settledError(replyAdapter(execute).replyToReview(replyInput()))

    expect(error).toMatchObject(match)
    expect(error.message).toEqual(message)
    for (const leak of leaks) {
      expect(error.message).not.toContain(leak)
      expect(JSON.stringify(error)).not.toContain(leak)
    }
  })

  // The reply workflow classifies an answered 4xx as a terminal rejection from
  // this evidence, never from the code, so naming the code for what it is
  // (Google rejected the request) changes no reply outcome.
  it.each([400, 404])(
    'carries an answered %i of a reply as a rejection with its status',
    async (status) => {
      const execute = answered(status, { body: '{"error":{"message":"gone"}}' })

      const error = await settledError(replyAdapter(execute).replyToReview(replyInput()))

      expect(error).toMatchObject({
        code: 'provider_rejected',
        recoverable: false,
        failure: { executionCode: null, dispatch: 'answered', providerStatus: status },
      })
      expect(error.message).toBe(
        `Google review API request failed (upstream_error; answered; status ${status})`,
      )
    },
  )

  // The authorizer refuses before any credential or provider access. Its closed
  // code is the only thing that separates RepKey's own lifecycle/epoch refusal
  // (`stale_source`) from a changed approval, so it rides along as not_sent.
  it.each(['stale_source', 'authorization_denied', 'runtime_unavailable'])(
    'carries a %s authorizer refusal as not_sent evidence',
    async (code) => {
      const execute = vi.fn()
      const { api } = createAdapter({
        execute,
        authorizeReplyPublicationProviderCall: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error(`authorization is unavailable: ${code}`), { code }),
          ),
      })

      const error = await settledError(api.replyToReview(publicationInput()))

      expect(error).toMatchObject({
        _tag: 'GoogleReviewApiError',
        code: 'authorization_changed',
        recoverable: false,
        failure: { executionCode: code, dispatch: 'not_sent', providerStatus: null },
      })
      expect(error.message).toBe(`Google review API request failed (${code}; not_sent)`)
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('drops an authorizer refusal code that is not a closed-union word', async () => {
    const { api } = createAdapter({
      execute: vi.fn(),
      authorizeReplyPublicationProviderCall: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('boom'), { code: 'Reply text: hi' })),
    })

    const error = await settledError(api.replyToReview(publicationInput()))

    expect(error).toMatchObject({
      code: 'authorization_changed',
      failure: { executionCode: null, dispatch: 'not_sent', providerStatus: null },
    })
    expect(error.message).not.toContain('Reply text')
  })

  it('accepts a 200 answer whose body is not JSON: Google took the write', async () => {
    const execute = answered(200, {
      contentType: 'text/html; charset=utf-8',
      headers: { providerCorrelationId: 'provider-request-2' },
      body: '<html></html>',
    })

    await expect(replyAdapter(execute).replyToReview(replyInput())).resolves.toEqual({
      providerCorrelationId: null,
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it.each([
    ['an empty reply', { text: '' }],
    ['a non-UUID reply id', { replyId: 'reply-1' }],
    ['a reply over 4,096 UTF-8 bytes', { text: 'Ж'.repeat(2_049) }],
  ])('refuses %s before the executor, as not_sent', async (_label, override) => {
    const execute = vi.fn()

    const error = await settledError(
      replyAdapter(execute).replyToReview({ ...replyInput(), ...override }),
    )

    // The same refusal the compile step gives: never sent, and never retried.
    expect(error).toMatchObject({
      code: 'provider_unavailable',
      failure: {
        executionCode: 'malformed_request',
        dispatch: 'not_sent',
        providerStatus: null,
      },
    })
    expect(classifyPublicationFailure(error)).toBe('terminal_rejection')
    expect(error.message).toBe(
      'Google review API request failed (malformed_request; not_sent)',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('lets line feeds, carriage returns and tabs through its own input check', async () => {
    const text = 'Thank you.\r\n\tSee you soon.'
    const execute = jsonAnswer({}, { contentType: 'application/json' })
    const { api } = createAdapter({
      execute,
      authorizeReplyPublicationProviderCall: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        authorization: {
          ...publicationAuthorization,
          authorizationVector: {
            ...publicationAuthorization.authorizationVector,
            expectedReplyDigest: googleReplyTextDigest(text),
          },
        },
      }),
    })

    await expect(api.replyToReview({ ...publicationInput(), text })).resolves.toEqual({
      providerCorrelationId: null,
    })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ comment: text }),
      expect.anything(),
    )
  })

  it('refuses a control character the reply rule rejects, before the executor', async () => {
    const execute = vi.fn()

    const error = await settledError(
      replyAdapter(execute).replyToReview({ ...replyInput(), text: 'Thanks\u0001' }),
    )

    expect(error).toMatchObject({
      failure: { executionCode: 'malformed_request', dispatch: 'not_sent' },
    })
    expect(classifyPublicationFailure(error)).toBe('terminal_rejection')
    expect(execute).not.toHaveBeenCalled()
  })
})
