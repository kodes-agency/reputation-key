import { describe, it, expect } from 'vitest'
import {
  MAX_PAGES_PER_RUN,
  MAX_RUN_DURATION_MS,
  shouldCheckpoint,
  shouldUpsertReview,
  classifySyncError,
} from './bounded-sync-policy'

describe('bounded-sync-policy (B1.7)', () => {
  describe('shouldCheckpoint', () => {
    it('returns false when under both budgets', () => {
      expect(shouldCheckpoint(10, 30_000)).toBe(false)
    })

    it('returns true when page budget exceeded', () => {
      expect(shouldCheckpoint(MAX_PAGES_PER_RUN, 30_000)).toBe(true)
    })

    it('returns true when time budget exceeded', () => {
      expect(shouldCheckpoint(5, MAX_RUN_DURATION_MS)).toBe(true)
    })

    it('returns true when both budgets exceeded', () => {
      expect(shouldCheckpoint(MAX_PAGES_PER_RUN + 10, MAX_RUN_DURATION_MS + 1000)).toBe(
        true,
      )
    })
  })

  describe('shouldUpsertReview', () => {
    it('returns true for new review (null existing)', () => {
      expect(shouldUpsertReview(null, new Date('2026-07-14'))).toBe(true)
    })

    it('returns true when incoming is newer', () => {
      expect(shouldUpsertReview(new Date('2026-07-10'), new Date('2026-07-14'))).toBe(
        true,
      )
    })

    it('returns false when incoming is older', () => {
      expect(shouldUpsertReview(new Date('2026-07-14'), new Date('2026-07-10'))).toBe(
        false,
      )
    })

    it('returns false when timestamps are equal', () => {
      const ts = new Date('2026-07-14T12:00:00Z')
      expect(shouldUpsertReview(ts, ts)).toBe(false)
    })
  })

  describe('classifySyncError', () => {
    it('classifies 429 as retryable with backoff', () => {
      const result = classifySyncError(429)
      expect(result.kind).toBe('retryable')
      if (result.kind === 'retryable') {
        expect(result.reason).toBe('rate_limited')
        expect(result.retryAfterMs).toBe(60_000)
      }
    })

    it('classifies 500 as retryable', () => {
      const result = classifySyncError(503)
      expect(result.kind).toBe('retryable')
    })

    it('classifies 401 as reauth_required', () => {
      const result = classifySyncError(401)
      expect(result.kind).toBe('reauth_required')
    })

    it('classifies 403 without quota as terminal', () => {
      const result = classifySyncError(403)
      expect(result.kind).toBe('terminal')
      expect(result.reason).toBe('forbidden')
    })

    it('classifies 403 with quota as retryable', () => {
      const result = classifySyncError(403, 'quota exceeded')
      expect(result.kind).toBe('retryable')
      expect(result.reason).toBe('quota_exceeded')
    })

    it('classifies 404 as terminal (deleted)', () => {
      const result = classifySyncError(404)
      expect(result.kind).toBe('terminal')
      expect(result.reason).toBe('not_found')
    })

    it('classifies 409 as retryable', () => {
      const result = classifySyncError(409)
      expect(result.kind).toBe('retryable')
    })

    it('classifies unknown 4xx as terminal', () => {
      const result = classifySyncError(422)
      expect(result.kind).toBe('terminal')
    })
  })
})
