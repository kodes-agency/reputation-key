import { describe, it, expect } from 'vitest'
import {
  isValidPublicationTransition,
  assertValidPublicationTransition,
  isPublicationActive,
  isPublicationTerminal,
  isPublished,
  requiresManualReview,
  buildIdempotencyKey,
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
})
