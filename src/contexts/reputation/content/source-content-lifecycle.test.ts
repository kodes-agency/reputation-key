// Tests for review source content lifecycle (ADR 0031).

import { describe, it, expect } from 'vitest'
import {
  computeReviewContentHash,
  contentRefreshDueThreshold,
} from './source-content-lifecycle.server'

const NOW = new Date('2026-07-15T12:00:00Z')
const DAYS = 24 * 60 * 60 * 1000

describe('computeReviewContentHash (re-export)', () => {
  it('is available for write-path callers via lifecycle module', () => {
    const hash = computeReviewContentHash({
      rating: 5,
      text: 'x',
      reviewerName: null,
      languageCode: 'en',
    })
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('contentRefreshDueThreshold', () => {
  it('is now + (TTL − refresh-due) lead window (5 days for Google policy)', () => {
    const threshold = contentRefreshDueThreshold(NOW)
    expect(threshold.getTime() - NOW.getTime()).toBe(5 * DAYS)
  })
})
