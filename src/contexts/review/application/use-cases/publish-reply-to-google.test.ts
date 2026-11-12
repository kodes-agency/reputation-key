import { describe, expect, it, vi } from 'vitest'
import {
  createGoogleCallError,
  type GoogleCallErrorKind,
} from '#/contexts/integration/domain/google-call-error'
import {
  classifyPublicationFailure,
  publicationFailureCause,
  publicationFailureEvidence,
} from '../../domain/reply-publication-workflow'
import { googleReviewApiNotConfigured } from '../ports/google-review-api.port'
import type { GoogleReplyPublicationRequest } from '../ports/google-review-api.port'
import { publishReplyToGoogle } from './publish-reply-to-google'

const REQUEST = {
  organizationId: 'org-1',
  connectionId: '00000000-0000-4000-8000-000000000001',
} as unknown as GoogleReplyPublicationRequest

type Shape = Readonly<{
  kind: GoogleCallErrorKind
  dispatch: 'not_sent' | 'answered' | 'unknown'
  providerStatus?: number
  executionCode?: string
  retryAfterMs?: number
}>

const callError = (shape: Shape) =>
  createGoogleCallError('reviews.reply', shape.kind, {
    dispatch: shape.dispatch,
    ...(shape.providerStatus === undefined
      ? {}
      : { providerStatus: shape.providerStatus }),
    ...(shape.executionCode === undefined ? {} : { executionCode: shape.executionCode }),
    ...(shape.retryAfterMs === undefined ? {} : { retryAfterMs: shape.retryAfterMs }),
  })

async function publishFailing(
  error: unknown,
  connectionStatus: () => Promise<string | null>,
) {
  const warn = vi.fn()
  const publish = publishReplyToGoogle({
    googleReviewApi: { replyToReview: async () => Promise.reject(error) },
    connectionStatus: { findStatus: connectionStatus },
    logger: { warn },
  })
  const thrown = await publish(REQUEST).then(
    () => null,
    (e: unknown) => e,
  )
  return { thrown, warn }
}

const ACTIVE = async () => 'active'

// Every failure the reply publish job reaches, as the integration adapter
// throws it, with the job's decision about it.
describe('publishReplyToGoogle failure shapes', () => {
  it.each([
    [
      'Google refusal 403',
      { kind: 'permission_denied', dispatch: 'answered', providerStatus: 403 },
      'terminal_rejection',
      'authorization_changed',
    ],
    [
      'Google refusal 401',
      { kind: 'auth_failed', dispatch: 'answered', providerStatus: 401 },
      'terminal_rejection',
      'authorization_changed',
    ],
    [
      'authorizer refusal',
      {
        kind: 'permission_denied',
        dispatch: 'not_sent',
        executionCode: 'authorization_denied',
      },
      'terminal_rejection',
      'authorization_changed',
    ],
    [
      'not found 404',
      { kind: 'upstream_error', dispatch: 'answered', providerStatus: 404 },
      'terminal_rejection',
      'provider_rejected',
    ],
    [
      'bad request 400',
      { kind: 'upstream_error', dispatch: 'answered', providerStatus: 400 },
      'terminal_rejection',
      'provider_rejected',
    ],
    [
      'rate limit 429',
      {
        kind: 'rate_limited',
        dispatch: 'answered',
        providerStatus: 429,
        retryAfterMs: 4000,
      },
      'retryable',
      'provider_rate_limited',
    ],
    [
      'admission quota',
      { kind: 'rate_limited', dispatch: 'not_sent', executionCode: 'admission_denied' },
      'retryable',
      'provider_rate_limited',
    ],
    [
      'server error 503',
      { kind: 'upstream_error', dispatch: 'answered', providerStatus: 503 },
      'ambiguous',
      'provider_unavailable',
    ],
    [
      'timeout',
      { kind: 'upstream_error', dispatch: 'unknown', executionCode: 'timeout' },
      'ambiguous',
      'provider_unavailable',
    ],
    [
      'deadline',
      { kind: 'upstream_error', dispatch: 'unknown', executionCode: 'deadline_exceeded' },
      'ambiguous',
      'provider_unavailable',
    ],
    [
      'refused before sending',
      {
        kind: 'upstream_error',
        dispatch: 'not_sent',
        executionCode: 'coordination_unavailable',
      },
      'retryable',
      'provider_unavailable',
    ],
    [
      'request refused by the compile step',
      { kind: 'parse_error', dispatch: 'not_sent', executionCode: 'malformed_request' },
      'terminal_rejection',
      'provider_unavailable',
    ],
  ] as const)('%s', async (_label, shape, expectedClass, expectedCode) => {
    const { thrown } = await publishFailing(callError(shape), ACTIVE)

    expect(thrown).toMatchObject({ _tag: 'GoogleReviewApiError', code: expectedCode })
    expect(classifyPublicationFailure(thrown)).toBe(expectedClass)
    expect(publicationFailureCause(thrown)).toBeNull()
    expect(publicationFailureEvidence(thrown)).toMatchObject({
      dispatch: shape.dispatch,
      providerStatus: 'providerStatus' in shape ? shape.providerStatus : null,
      executionCode: 'executionCode' in shape ? shape.executionCode : null,
    })
  })

  it('keeps the provider backoff hint of a rate limit', async () => {
    const { thrown } = await publishFailing(
      callError({
        kind: 'rate_limited',
        dispatch: 'answered',
        providerStatus: 429,
        retryAfterMs: 4000,
      }),
      ACTIVE,
    )
    expect(thrown).toMatchObject({ retryAfterMs: 4000, recoverable: true })
  })

  it('names the cause of a refusal while the connection waits for a reconnect', async () => {
    for (const shape of [
      { kind: 'auth_failed', dispatch: 'answered', providerStatus: 401 },
      {
        kind: 'permission_denied',
        dispatch: 'not_sent',
        executionCode: 'authorization_denied',
      },
    ] as const) {
      const { thrown } = await publishFailing(
        callError(shape),
        async () => 'reauth_required',
      )

      expect(thrown).toMatchObject({
        code: 'reauthorization_required',
        recoverable: false,
      })
      expect(classifyPublicationFailure(thrown)).toBe('terminal_rejection')
      expect(publicationFailureCause(thrown)).toBe('google_reauthorization_required')
      expect(publicationFailureEvidence(thrown).dispatch).toBe(shape.dispatch)
    }
  })

  it('does not name the reconnect cause for a refusal of a missing connection', async () => {
    const { thrown } = await publishFailing(
      callError({ kind: 'permission_denied', dispatch: 'answered', providerStatus: 403 }),
      async () => null,
    )
    expect(thrown).toMatchObject({ code: 'authorization_changed' })
    expect(publicationFailureCause(thrown)).toBeNull()
  })

  it('keeps the refusal as it was when the connection cannot be read', async () => {
    const { thrown, warn } = await publishFailing(
      callError({ kind: 'permission_denied', dispatch: 'answered', providerStatus: 403 }),
      async () => Promise.reject(new Error('db down')),
    )
    expect(thrown).toMatchObject({ code: 'authorization_changed' })
    expect(warn).toHaveBeenCalledWith(
      { event: 'google_reply_refusal_connection_unreadable' },
      expect.any(String),
    )
  })

  it('does not read the connection for failures that are not refusals', async () => {
    const findStatus = vi.fn(async () => 'reauth_required')
    await publishFailing(
      callError({ kind: 'upstream_error', dispatch: 'answered', providerStatus: 503 }),
      findStatus,
    )
    expect(findStatus).not.toHaveBeenCalled()
  })

  it('lets a process without a Google provider fail as it did, ambiguously', async () => {
    const failure = googleReviewApiNotConfigured()
    const { thrown } = await publishFailing(failure, ACTIVE)
    expect(thrown).toBe(failure)
    expect(classifyPublicationFailure(thrown)).toBe('ambiguous')
  })

  it('returns the provider outcome of an accepted reply', async () => {
    const publish = publishReplyToGoogle({
      googleReviewApi: { replyToReview: async () => ({ providerCorrelationId: 'c-1' }) },
      connectionStatus: { findStatus: ACTIVE },
      logger: { warn: vi.fn() },
    })
    await expect(publish(REQUEST)).resolves.toEqual({ providerCorrelationId: 'c-1' })
  })
})
