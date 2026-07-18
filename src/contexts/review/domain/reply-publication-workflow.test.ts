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
  nextPublicationState,
  AMBIGUOUS_RECONCILE_DELAY_MS,
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

    it('throws for invalid transitions', () => {
      expect(() => assertValidPublicationTransition('published', 'publishing')).toThrow()
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
    it('includes reply ID and source version', () => {
      const key = buildIdempotencyKey('reply-123', 2)
      expect(key).toBe('reply:reply-123:v2')
    })

    it('changes when source version changes', () => {
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

    it.each([500, 502, 503])('gbp_api_error with %i → retryable', (status) => {
      expect(classifyPublicationFailure(gbpError(status))).toBe('retryable')
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

    it('TypeError (fetch network failure) → retryable', () => {
      expect(classifyPublicationFailure(new TypeError('fetch failed'))).toBe('retryable')
    })

    it('unknown error → ambiguous', () => {
      expect(classifyPublicationFailure(new Error('socket hangup'))).toBe('ambiguous')
      expect(classifyPublicationFailure('weird string')).toBe('ambiguous')
      expect(classifyPublicationFailure(null)).toBe('ambiguous')
    })
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

  it('claim: authorized → sending; sending → sending (same job re-claiming its in-flight workflow)', () => {
    expect(nextPublicationState('authorized', 'claim')).toBe('sending')
    expect(nextPublicationState('sending', 'claim')).toBe('sending')
  })

  it('claim is invalid from NULL, cancelled, and terminal states (cancelled/racing rows cannot be claimed)', () => {
    expect(nextPublicationState(null, 'claim')).toBeNull()
    expect(nextPublicationState('cancelled', 'claim')).toBeNull()
    expect(nextPublicationState('terminal', 'claim')).toBeNull()
    expect(nextPublicationState('ambiguous', 'claim')).toBeNull()
    expect(nextPublicationState('published', 'claim')).toBeNull()
  })

  it('publish confirms from sending, and heals from terminal/ambiguous/NULL (provider confirmation is authoritative)', () => {
    expect(nextPublicationState('sending', 'publish')).toBe('published')
    expect(nextPublicationState('terminal', 'publish')).toBe('published')
    expect(nextPublicationState('ambiguous', 'publish')).toBe('published')
    expect(nextPublicationState(null, 'publish')).toBe('published')
  })

  it('fail_terminal / fail_ambiguous / requeue apply only to an in-flight send', () => {
    expect(nextPublicationState('sending', 'fail_terminal')).toBe('terminal')
    expect(nextPublicationState('sending', 'fail_ambiguous')).toBe('ambiguous')
    expect(nextPublicationState('sending', 'requeue')).toBe('authorized')
    expect(nextPublicationState('authorized', 'fail_terminal')).toBeNull()
    expect(nextPublicationState('authorized', 'fail_ambiguous')).toBeNull()
    expect(nextPublicationState('authorized', 'requeue')).toBeNull()
  })

  it('cancel applies to every publication-active state and to no terminal state', () => {
    expect(nextPublicationState('requested', 'cancel')).toBe('cancelled')
    expect(nextPublicationState('authorized', 'cancel')).toBe('cancelled')
    expect(nextPublicationState('sending', 'cancel')).toBe('cancelled')
    expect(nextPublicationState('published', 'cancel')).toBeNull()
    expect(nextPublicationState('terminal', 'cancel')).toBeNull()
    expect(nextPublicationState('ambiguous', 'cancel')).toBeNull()
    expect(nextPublicationState('cancelled', 'cancel')).toBeNull()
  })

  it('AMBIGUOUS_RECONCILE_DELAY_MS is 15 minutes', () => {
    expect(AMBIGUOUS_RECONCILE_DELAY_MS).toBe(15 * 60 * 1000)
  })
})
