import { describe, it, expect } from 'vitest'
import {
  isValidPublicationTransition,
  assertValidPublicationTransition,
  isPublicationActive,
  isPublicationTerminal,
  isPublished,
  requiresManualReview,
  buildIdempotencyKey,
  classifyPublicationFailure,
  publicationFailureEvidence,
  nextPublicationCycle,
  nextPublicationState,
  canDeferPendingProviderObservation,
  AMBIGUOUS_RECONCILE_DELAY_MS,
  PROVIDER_OBSERVATION_PROPAGATION_GRACE_MAX_READS,
  PROVIDER_OBSERVATION_PROPAGATION_GRACE_MS,
  PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
} from './reply-publication-workflow'

describe('reply-publication-workflow (B1.10)', () => {
  describe('isValidPublicationTransition', () => {
    it('allows idle → publish_requested', () => {
      expect(isValidPublicationTransition('idle', 'publish_requested')).toBe(true)
    })

    it('allows publish_requested → publishing', () => {
      expect(isValidPublicationTransition('publish_requested', 'publishing')).toBe(true)
    })

    it('allows publish_requested → rejected_terminal (e.g., review deleted)', () => {
      expect(isValidPublicationTransition('publish_requested', 'rejected_terminal')).toBe(
        true,
      )
    })

    it('allows publishing → published (Google confirmed)', () => {
      expect(isValidPublicationTransition('publishing', 'published')).toBe(true)
    })

    it('allows publishing → rejected_terminal (Google 403)', () => {
      expect(isValidPublicationTransition('publishing', 'rejected_terminal')).toBe(true)
    })

    it('allows publishing → outcome_unknown (crash/timeout)', () => {
      expect(isValidPublicationTransition('publishing', 'outcome_unknown')).toBe(true)
    })

    it('allows outcome_unknown → reconciling', () => {
      expect(isValidPublicationTransition('outcome_unknown', 'reconciling')).toBe(true)
    })

    it('allows reconciling → published (found on Google)', () => {
      expect(isValidPublicationTransition('reconciling', 'published')).toBe(true)
    })

    it('allows reconciling → retryable (not found, safe to retry)', () => {
      expect(isValidPublicationTransition('reconciling', 'retryable')).toBe(true)
    })

    it('allows reconciling → manual_review (ambiguous)', () => {
      expect(isValidPublicationTransition('reconciling', 'manual_review')).toBe(true)
    })

    it('allows retryable → publishing (retry after backoff)', () => {
      expect(isValidPublicationTransition('retryable', 'publishing')).toBe(true)
    })

    it('allows retryable → manual_review (max retries exceeded)', () => {
      expect(isValidPublicationTransition('retryable', 'manual_review')).toBe(true)
    })

    it('rejects published → publishing (terminal)', () => {
      expect(isValidPublicationTransition('published', 'publishing')).toBe(false)
    })

    it('rejects rejected_terminal → publishing (terminal)', () => {
      expect(isValidPublicationTransition('rejected_terminal', 'publishing')).toBe(false)
    })

    it('rejects manual_review → publishing (terminal)', () => {
      expect(isValidPublicationTransition('manual_review', 'publishing')).toBe(false)
    })

    it('rejects idle → publishing (must go through publish_requested)', () => {
      expect(isValidPublicationTransition('idle', 'publishing')).toBe(false)
    })

    it('rejects same-state transitions', () => {
      expect(isValidPublicationTransition('publishing', 'publishing')).toBe(false)
    })
  })

  describe('assertValidPublicationTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() =>
        assertValidPublicationTransition('idle', 'publish_requested'),
      ).not.toThrow()
    })

    it('throws tagged ReviewError for invalid transitions', () => {
      try {
        assertValidPublicationTransition('published', 'publishing')
        expect.fail('expected throw')
      } catch (e) {
        expect(e).toMatchObject({
          _tag: 'ReviewError',
          code: 'invalid_transition',
        })
      }
    })
  })

  describe('isPublicationActive', () => {
    it('returns true for publish_requested', () => {
      expect(isPublicationActive('publish_requested')).toBe(true)
    })

    it('returns true for publishing', () => {
      expect(isPublicationActive('publishing')).toBe(true)
    })

    it('returns true for outcome_unknown', () => {
      expect(isPublicationActive('outcome_unknown')).toBe(true)
    })

    it('returns true for reconciling', () => {
      expect(isPublicationActive('reconciling')).toBe(true)
    })

    it('returns true for retryable', () => {
      expect(isPublicationActive('retryable')).toBe(true)
    })

    it('returns false for idle', () => {
      expect(isPublicationActive('idle')).toBe(false)
    })

    it('returns false for published', () => {
      expect(isPublicationActive('published')).toBe(false)
    })
  })

  describe('isPublicationTerminal', () => {
    it('returns true for published', () => {
      expect(isPublicationTerminal('published')).toBe(true)
    })

    it('returns true for rejected_terminal', () => {
      expect(isPublicationTerminal('rejected_terminal')).toBe(true)
    })

    it('returns true for manual_review', () => {
      expect(isPublicationTerminal('manual_review')).toBe(true)
    })

    it('returns false for publishing', () => {
      expect(isPublicationTerminal('publishing')).toBe(false)
    })
  })

  describe('isPublished', () => {
    it('returns true for published', () => {
      expect(isPublished('published')).toBe(true)
    })

    it('returns false for publishing', () => {
      expect(isPublished('publishing')).toBe(false)
    })

    it('returns false for outcome_unknown', () => {
      expect(isPublished('outcome_unknown')).toBe(false)
    })
  })

  describe('requiresManualReview', () => {
    it('returns true for manual_review', () => {
      expect(requiresManualReview('manual_review')).toBe(true)
    })

    it('returns true for outcome_unknown', () => {
      expect(requiresManualReview('outcome_unknown')).toBe(true)
    })

    it('returns false for publishing', () => {
      expect(requiresManualReview('publishing')).toBe(false)
    })

    it('returns false for published', () => {
      expect(requiresManualReview('published')).toBe(false)
    })
  })

  describe('buildIdempotencyKey', () => {
    it('includes reply ID and publication cycle', () => {
      const key = buildIdempotencyKey('reply-123', 2)
      expect(key).toBe('reply-reply-123-v2')
      expect(key).not.toContain(':')
    })

    it('changes when publication cycle changes', () => {
      const key1 = buildIdempotencyKey('reply-123', 1)
      const key2 = buildIdempotencyKey('reply-123', 2)
      expect(key1).not.toBe(key2)
    })

    it('changes when reply ID changes', () => {
      const key1 = buildIdempotencyKey('reply-123', 1)
      const key2 = buildIdempotencyKey('reply-456', 1)
      expect(key1).not.toBe(key2)
    })
  })

  describe('nextPublicationCycle', () => {
    it('advances the explicit authorization generation', () => {
      expect(nextPublicationCycle(0)).toBe(1)
      expect(nextPublicationCycle(41)).toBe(42)
    })

    it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
      'rejects invalid or unadvanceable cycle %s',
      (current) => {
        expect(() => nextPublicationCycle(current)).toThrow(
          'Reply publication cycle is invalid',
        )
      },
    )
  })

  // BQC-3.3: provider outcome classification for the publish job.
  describe('classifyPublicationFailure', () => {
    const gbpError = (status: number) =>
      Object.assign(new Error('Failed to reach Google review API'), {
        _tag: 'IntegrationError',
        code: 'gbp_api_error',
        context: { operation: 'reply', status, bodyBytes: 42 },
      })

    it.each([400, 401, 403, 404, 409])(
      'gbp_api_error with %i → terminal_rejection',
      (status) => {
        expect(classifyPublicationFailure(gbpError(status))).toBe('terminal_rejection')
      },
    )

    it.each([500, 502, 503])('gbp_api_error with %i → ambiguous', (status) => {
      expect(classifyPublicationFailure(gbpError(status))).toBe('ambiguous')
    })

    it('direct GoogleReviewApiError provider_unavailable → ambiguous', () => {
      const err = Object.assign(new Error('Google provider unavailable'), {
        _tag: 'GoogleReviewApiError',
        code: 'provider_unavailable',
        recoverable: true,
      })
      expect(classifyPublicationFailure(err)).toBe('ambiguous')
    })

    it('direct GoogleReviewApiError authorization_changed → terminal_rejection', () => {
      // A refusal (401/403, revoked grant, changed approval binding) is an
      // answer. Classifying it as ambiguous kept a permanently refused reply
      // in 'sending' until every attempt was burned.
      const err = Object.assign(new Error('Google authorization changed'), {
        _tag: 'GoogleReviewApiError',
        code: 'authorization_changed',
        recoverable: false,
      })
      expect(classifyPublicationFailure(err)).toBe('terminal_rejection')
    })

    it('gbp_api_rate_limited (429) → retryable', () => {
      const err = Object.assign(new Error('Failed to reach Google review API'), {
        _tag: 'IntegrationError',
        code: 'gbp_api_rate_limited',
        context: { status: 429 },
      })
      expect(classifyPublicationFailure(err)).toBe('retryable')
    })

    it('gbp_api_error without a status → ambiguous', () => {
      const err = Object.assign(new Error('Failed to reach Google review API'), {
        _tag: 'IntegrationError',
        code: 'gbp_api_error',
        context: { operation: 'reply' },
      })
      expect(classifyPublicationFailure(err)).toBe('ambiguous')
    })

    it.each(['auth_failed', 'permission_denied'])(
      'gateway GbpApiError %s → terminal_rejection',
      (kind) => {
        const err = Object.assign(new Error(`GBP reply failed (${kind})`), {
          _tag: 'GbpApiError',
          kind,
        })
        expect(classifyPublicationFailure(err)).toBe('terminal_rejection')
      },
    )

    it('gateway GbpApiError rate_limited → retryable', () => {
      const err = Object.assign(new Error('GBP reply failed (rate_limited)'), {
        _tag: 'GbpApiError',
        kind: 'rate_limited',
      })
      expect(classifyPublicationFailure(err)).toBe('retryable')
    })

    it('gateway GbpApiError upstream_error → ambiguous', () => {
      const err = Object.assign(new Error('GBP reply failed (upstream_error)'), {
        _tag: 'GbpApiError',
        kind: 'upstream_error',
      })
      expect(classifyPublicationFailure(err)).toBe('ambiguous')
    })

    it('gateway GbpApiError parse_error → ambiguous', () => {
      const err = Object.assign(new Error('GBP reply response could not be parsed'), {
        _tag: 'GbpApiError',
        kind: 'parse_error',
      })
      expect(classifyPublicationFailure(err)).toBe('ambiguous')
    })

    it('token_refresh_failed → retryable (pre-request, transient)', () => {
      const err = Object.assign(new Error('token refresh failed'), {
        _tag: 'IntegrationError',
        code: 'token_refresh_failed',
      })
      expect(classifyPublicationFailure(err)).toBe('retryable')
    })

    it.each(['connection_not_found', 'connection_inactive', 'connection_disconnected'])(
      '%s → terminal_rejection (pre-request, permanent until reconnect)',
      (code) => {
        const err = Object.assign(new Error('connection problem'), {
          _tag: 'IntegrationError',
          code,
        })
        expect(classifyPublicationFailure(err)).toBe('terminal_rejection')
      },
    )

    it('AbortError (timeout after the request may have landed) → ambiguous', () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      expect(classifyPublicationFailure(err)).toBe('ambiguous')
    })

    it('TypeError (fetch transport outcome unknown) → ambiguous', () => {
      expect(classifyPublicationFailure(new TypeError('fetch failed'))).toBe('ambiguous')
    })

    it('unknown error → ambiguous', () => {
      expect(classifyPublicationFailure(new Error('socket hangup'))).toBe('ambiguous')
      expect(classifyPublicationFailure('weird string')).toBe('ambiguous')
      expect(classifyPublicationFailure(null)).toBe('ambiguous')
    })
  })

  // D2: the incident reply (three line feeds) was refused by the executor's
  // compile step with no permit and no fetch, yet the review adapter reported
  // `provider_unavailable` with no dispatch evidence and this classifier called
  // it ambiguous, so attempt 2 read Google once and parked the reply in
  // "Needs a check". The dispatch the gateway recorded decides instead.
  describe('classifyPublicationFailure by recorded dispatch (D2)', () => {
    type Failure = Readonly<{
      executionCode: string | null
      dispatch: 'not_sent' | 'answered' | 'unknown'
      providerStatus: number | null
    }>
    const reviewApiError = (code: string, failure?: Failure) =>
      Object.assign(new Error('Google review API request failed'), {
        _tag: 'GoogleReviewApiError',
        code,
        recoverable: false,
        ...(failure === undefined ? {} : { failure }),
      })
    const abort = () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      return err
    }

    it.each([
      [
        'rule 1: AbortError, even with not_sent evidence attached',
        Object.assign(abort(), {
          _tag: 'GoogleReviewApiError',
          code: 'provider_unavailable',
          failure: { executionCode: null, dispatch: 'not_sent', providerStatus: null },
        }),
        'ambiguous',
      ],
      ['rule 1: bare AbortError', abort(), 'ambiguous'],
      [
        'rule 2: invalid_request (refused before the executor)',
        reviewApiError('invalid_request', {
          executionCode: null,
          dispatch: 'not_sent',
          providerStatus: null,
        }),
        'terminal_rejection',
      ],
      [
        'rule 2: invalid_request without failure evidence',
        reviewApiError('invalid_request'),
        'terminal_rejection',
      ],
      [
        'rule 2: authorization_changed wins over not_sent',
        reviewApiError('authorization_changed', {
          executionCode: 'authorization_denied',
          dispatch: 'not_sent',
          providerStatus: null,
        }),
        'terminal_rejection',
      ],
      [
        'rule 3: not_sent + malformed_request (deterministic compile refusal)',
        reviewApiError('provider_unavailable', {
          executionCode: 'malformed_request',
          dispatch: 'not_sent',
          providerStatus: null,
        }),
        'terminal_rejection',
      ],
      [
        'rule 3: not_sent + coordination_unavailable',
        reviewApiError('provider_unavailable', {
          executionCode: 'coordination_unavailable',
          dispatch: 'not_sent',
          providerStatus: null,
        }),
        'retryable',
      ],
      [
        // The gateway and admission report an elapsed deadline as this code,
        // not `malformed_request`, so slow permit issuance stays retryable.
        'rule 3: not_sent + deadline_exceeded',
        reviewApiError('provider_unavailable', {
          executionCode: 'deadline_exceeded',
          dispatch: 'not_sent',
          providerStatus: null,
        }),
        'retryable',
      ],
      [
        'rule 4: answered 401 (a 401 refresh retry refused before its own fetch)',
        reviewApiError('provider_rate_limited', {
          executionCode: 'quota_exhausted',
          dispatch: 'answered',
          providerStatus: 401,
        }),
        'terminal_rejection',
      ],
      [
        'rule 4: answered 404',
        reviewApiError('provider_unavailable', {
          executionCode: null,
          dispatch: 'answered',
          providerStatus: 404,
        }),
        'terminal_rejection',
      ],
      [
        'rule 4: answered 429',
        reviewApiError('provider_rate_limited', {
          executionCode: null,
          dispatch: 'answered',
          providerStatus: 429,
        }),
        'retryable',
      ],
      [
        'rule 4: answered 503',
        reviewApiError('provider_unavailable', {
          executionCode: null,
          dispatch: 'answered',
          providerStatus: 503,
        }),
        'ambiguous',
      ],
      [
        'rule 4: answered without a status',
        reviewApiError('provider_unavailable', {
          executionCode: 'response_too_large',
          dispatch: 'answered',
          providerStatus: null,
        }),
        'ambiguous',
      ],
      [
        'rule 5: provider_rate_limited with unknown dispatch',
        reviewApiError('provider_rate_limited', {
          executionCode: 'transport_error',
          dispatch: 'unknown',
          providerStatus: null,
        }),
        'retryable',
      ],
      [
        'rule 6: unknown dispatch',
        reviewApiError('provider_unavailable', {
          executionCode: 'transport_error',
          dispatch: 'unknown',
          providerStatus: null,
        }),
        'ambiguous',
      ],
      [
        'rule 6: missing failure evidence',
        reviewApiError('provider_unavailable'),
        'ambiguous',
      ],
      [
        'rule 6: an unrecognised dispatch value is not evidence',
        reviewApiError('provider_unavailable', {
          executionCode: 'malformed_request',
          dispatch: 'maybe' as never,
          providerStatus: null,
        }),
        'ambiguous',
      ],
    ])('%s', (_label, err, expected) => {
      expect(classifyPublicationFailure(err)).toBe(expected)
    })

    it.each([
      [
        'not_sent + malformed_request',
        { dispatch: 'not_sent', executionCode: 'malformed_request' },
        'terminal_rejection',
      ],
      [
        'not_sent + admission coordination outage',
        {
          dispatch: 'not_sent',
          executionCode: 'admission_denied',
          executionAdmissionCode: 'coordination_unavailable',
        },
        'retryable',
      ],
      [
        'answered 404',
        { dispatch: 'answered', providerStatus: 404 },
        'terminal_rejection',
      ],
      ['answered 503', { dispatch: 'answered', providerStatus: 503 }, 'ambiguous'],
      [
        'unknown dispatch keeps the kind rule',
        { dispatch: 'unknown', executionCode: 'transport_error' },
        'ambiguous',
      ],
      ['no dispatch field keeps the kind rule', {}, 'ambiguous'],
    ])('gateway GbpApiError upstream_error with %s', (_label, fields, expected) => {
      const err = Object.assign(
        new Error('GBP API reviews.reply failed (upstream_error)'),
        {
          _tag: 'GbpApiError',
          kind: 'upstream_error',
          ...fields,
        },
      )
      expect(classifyPublicationFailure(err)).toBe(expected)
    })

    it('a GbpApiError refusal stays terminal even when it was refused before dispatch', () => {
      const err = Object.assign(
        new Error('GBP API reviews.reply failed (permission_denied)'),
        {
          _tag: 'GbpApiError',
          kind: 'permission_denied',
          dispatch: 'not_sent',
          executionCode: 'admission_denied',
          executionAdmissionCode: 'authorization_denied',
        },
      )
      expect(classifyPublicationFailure(err)).toBe('terminal_rejection')
    })
  })

  describe('publicationFailureEvidence', () => {
    it('reads the content-free dispatch evidence from a review API error', () => {
      const err = Object.assign(new Error('Google review API request failed'), {
        _tag: 'GoogleReviewApiError',
        code: 'provider_unavailable',
        failure: {
          executionCode: 'malformed_request',
          dispatch: 'not_sent',
          providerStatus: null,
        },
      })
      expect(publicationFailureEvidence(err)).toEqual({
        executionCode: 'malformed_request',
        dispatch: 'not_sent',
        providerStatus: null,
      })
    })

    it('reads the most specific code from a gateway GbpApiError', () => {
      const err = Object.assign(
        new Error('GBP API reviews.reply failed (upstream_error)'),
        {
          _tag: 'GbpApiError',
          kind: 'upstream_error',
          dispatch: 'answered',
          executionCode: 'admission_denied',
          executionAdmissionCode: 'coordination_unavailable',
          providerStatus: 502,
        },
      )
      expect(publicationFailureEvidence(err)).toEqual({
        executionCode: 'coordination_unavailable',
        dispatch: 'answered',
        providerStatus: 502,
      })
    })

    it.each([new TypeError('fetch failed'), null, 'text', { failure: 'nope' }])(
      'reports unknown dispatch without evidence: %o',
      (err) => {
        expect(publicationFailureEvidence(err)).toEqual({
          executionCode: null,
          dispatch: 'unknown',
          providerStatus: null,
        })
      },
    )
  })
})

describe('nextPublicationState (BQC-3.8 persisted machine)', () => {
  it('authorize starts a new cycle from NULL, terminal, ambiguous, or cancelled', () => {
    expect(nextPublicationState(null, 'authorize')).toBe('authorized')
    expect(nextPublicationState('terminal', 'authorize')).toBe('authorized')
    expect(nextPublicationState('ambiguous', 'authorize')).toBe('authorized')
    expect(nextPublicationState('cancelled', 'authorize')).toBe('authorized')
  })

  it('authorize is invalid from published (a completed publication never re-opens)', () => {
    expect(nextPublicationState('published', 'authorize')).toBeNull()
  })

  it('only a fresh authorization can claim one provider write', () => {
    expect(nextPublicationState('authorized', 'claim')).toBe('sending')
    expect(nextPublicationState('requested', 'claim')).toBeNull()
    expect(nextPublicationState('sending', 'claim')).toBeNull()
  })

  it('claim is invalid from NULL, cancelled, and terminal states (cancelled/racing rows cannot be claimed)', () => {
    expect(nextPublicationState(null, 'claim')).toBeNull()
    expect(nextPublicationState('cancelled', 'claim')).toBeNull()
    expect(nextPublicationState('terminal', 'claim')).toBeNull()
    expect(nextPublicationState('ambiguous', 'claim')).toBeNull()
    expect(nextPublicationState('published', 'claim')).toBeNull()
  })

  it('provider acceptance waits for observation; exact observation then publishes and can heal uncertain/legacy rows', () => {
    expect(nextPublicationState('sending', 'provider_accepted')).toBe(
      'pending_observation',
    )
    expect(nextPublicationState('sending', 'publish')).toBeNull()
    expect(nextPublicationState('pending_observation', 'publish')).toBe('published')
    expect(nextPublicationState('terminal', 'publish')).toBe('published')
    expect(nextPublicationState('ambiguous', 'publish')).toBe('published')
    expect(nextPublicationState(null, 'publish')).toBe('published')
  })

  it('bounds orphaned and uncertain publication states while keeping requeue send-only', () => {
    expect(nextPublicationState('requested', 'fail_terminal')).toBe('terminal')
    expect(nextPublicationState('authorized', 'fail_terminal')).toBe('terminal')
    expect(nextPublicationState('sending', 'fail_terminal')).toBe('terminal')
    expect(nextPublicationState('ambiguous', 'fail_terminal')).toBe('terminal')
    expect(nextPublicationState('sending', 'fail_ambiguous')).toBe('ambiguous')
    expect(nextPublicationState('pending_observation', 'fail_ambiguous')).toBe(
      'ambiguous',
    )
    expect(nextPublicationState('sending', 'requeue')).toBe('authorized')

    expect(nextPublicationState('pending_observation', 'fail_terminal')).toBeNull()
    expect(nextPublicationState('authorized', 'fail_ambiguous')).toBeNull()
    expect(nextPublicationState('authorized', 'requeue')).toBeNull()
  })

  it('cancel applies to every publication-active state and to no terminal state', () => {
    expect(nextPublicationState('requested', 'cancel')).toBe('cancelled')
    expect(nextPublicationState('authorized', 'cancel')).toBe('cancelled')
    expect(nextPublicationState('sending', 'cancel')).toBe('cancelled')
    expect(nextPublicationState('pending_observation', 'cancel')).toBe('cancelled')
    expect(nextPublicationState('published', 'cancel')).toBeNull()
    expect(nextPublicationState('terminal', 'cancel')).toBeNull()
    expect(nextPublicationState('ambiguous', 'cancel')).toBeNull()
    expect(nextPublicationState('cancelled', 'cancel')).toBeNull()
  })

  it('AMBIGUOUS_RECONCILE_DELAY_MS is 15 minutes', () => {
    expect(AMBIGUOUS_RECONCILE_DELAY_MS).toBe(15 * 60 * 1000)
  })

  it('bounds pending-provider propagation by both attempt age and absent reads', () => {
    const attemptStartedAt = new Date('2026-09-09T10:01:34Z')

    expect(PROVIDER_OBSERVATION_PROPAGATION_GRACE_MS).toBe(15 * 60 * 1000)
    expect(PROVIDER_OBSERVATION_PROPAGATION_GRACE_MAX_READS).toBe(3)
    expect(
      canDeferPendingProviderObservation({
        attemptStartedAt,
        now: new Date(attemptStartedAt.getTime() + 15 * 60 * 1000 - 1),
        absentObservationCount: 3,
      }),
    ).toBe(true)
    expect(
      canDeferPendingProviderObservation({
        attemptStartedAt,
        now: new Date(attemptStartedAt.getTime() + 15 * 60 * 1000),
        absentObservationCount: 1,
      }),
    ).toBe(false)
    expect(
      canDeferPendingProviderObservation({
        attemptStartedAt,
        now: new Date(attemptStartedAt.getTime() + 5 * 60 * 1000),
        absentObservationCount: 4,
      }),
    ).toBe(false)
  })

  it('PUBLICATION_RECOVERY_RECONCILE_DELAY_MS exceeds the 17.5-minute retry horizon', () => {
    expect(PUBLICATION_RECOVERY_RECONCILE_DELAY_MS).toBe(20 * 60 * 1000)
  })
})
