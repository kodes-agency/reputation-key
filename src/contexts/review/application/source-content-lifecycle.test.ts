// Tests for review source content lifecycle (PRE17B / ADR 0031).

import { describe, it, expect } from 'vitest'
import {
  calculateContentExpiry,
  checkContentStatus,
  classifyReviewsForRefresh,
  computeReviewContentHash,
  contentRefreshDueThreshold,
} from './source-content-lifecycle'

const NOW = new Date('2026-07-15T12:00:00Z')
const DAYS = 24 * 60 * 60 * 1000

describe('calculateContentExpiry', () => {
  it('returns null when lastFetchedAt is null', () => {
    expect(calculateContentExpiry(null)).toBeNull()
  })

  it('returns lastFetched + 30 days (Google TTL)', () => {
    const fetched = new Date('2026-07-01T12:00:00Z')
    const expiry = calculateContentExpiry(fetched)
    expect(expiry).toEqual(new Date('2026-07-31T12:00:00Z'))
  })
})

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

describe('checkContentStatus', () => {
  it('returns no_content when no fetch date', () => {
    const result = checkContentStatus(null, null, NOW)
    expect(result.status).toBe('no_content')
  })

  it('returns fresh when within safe window', () => {
    const fetched = new Date('2026-07-10T12:00:00Z') // 5 days ago
    const expiry = new Date(fetched.getTime() + 30 * DAYS)
    const result = checkContentStatus(fetched, expiry, NOW)
    expect(result.status).toBe('fresh')
    expect(result.daysUntilExpiry).toBe(25)
  })

  it('returns refresh_due when past 25-day threshold', () => {
    const fetched = new Date('2026-06-18T12:00:00Z') // 27 days ago
    const expiry = new Date(fetched.getTime() + 30 * DAYS) // 3 days left
    const result = checkContentStatus(fetched, expiry, NOW)
    expect(result.status).toBe('refresh_due')
    expect(result.daysUntilExpiry).toBe(3)
  })

  it('returns expired when past 30-day TTL', () => {
    const fetched = new Date('2026-06-14T12:00:00Z') // 31 days ago
    const expiry = new Date(fetched.getTime() + 30 * DAYS) // expired yesterday
    const result = checkContentStatus(fetched, expiry, NOW)
    expect(result.status).toBe('expired')
    expect(result.daysUntilExpiry).toBeLessThanOrEqual(0)
  })
})

describe('classifyReviewsForRefresh', () => {
  it('classifies reviews into fresh, refresh_due, and expired buckets', () => {
    const d = (s: string) => new Date(s)
    const reviews = [
      {
        id: 'fresh-1',
        lastFetchedAt: d('2026-07-14T12:00:00Z'),
        contentExpiresAt: new Date(d('2026-07-14T12:00:00Z').getTime() + 30 * DAYS),
      },
      {
        id: 'due-1',
        lastFetchedAt: d('2026-06-18T12:00:00Z'),
        contentExpiresAt: new Date(d('2026-06-18T12:00:00Z').getTime() + 30 * DAYS),
      },
      {
        id: 'expired-1',
        lastFetchedAt: d('2026-06-14T12:00:00Z'),
        contentExpiresAt: new Date(d('2026-06-14T12:00:00Z').getTime() + 30 * DAYS),
      },
      { id: 'no-content', lastFetchedAt: null, contentExpiresAt: null },
    ]

    const result = classifyReviewsForRefresh(reviews, NOW)
    expect(result.fresh).toContain('fresh-1')
    expect(result.refreshDue).toContain('due-1')
    expect(result.expired).toContain('expired-1')
    expect(result.fresh).not.toContain('no-content')
  })
})
