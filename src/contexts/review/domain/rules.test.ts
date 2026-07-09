// Review context — domain rules tests

import { describe, it, expect } from 'vitest'
import {
  isValidRating,
  calculateExpiresAt,
  canTransitionReply,
  MAX_REPLY_LENGTH,
} from './rules'

describe('isValidRating', () => {
  it('returns true for valid ratings 1-5', () => {
    expect(isValidRating(1)).toBe(true)
    expect(isValidRating(2)).toBe(true)
    expect(isValidRating(3)).toBe(true)
    expect(isValidRating(4)).toBe(true)
    expect(isValidRating(5)).toBe(true)
  })

  it('returns false for invalid ratings', () => {
    expect(isValidRating(0)).toBe(false)
    expect(isValidRating(6)).toBe(false)
    expect(isValidRating(-1)).toBe(false)
    expect(isValidRating(3.5)).toBe(false)
  })
})

describe('calculateExpiresAt', () => {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

  it('returns now + remaining retention for recent review', () => {
    const now = new Date('2025-06-01T12:00:00Z')
    const reviewedAt = new Date('2025-05-27T12:00:00Z') // 5 days ago

    const expiresAt = calculateExpiresAt(reviewedAt, now)

    const expected = new Date(now.getTime() + (THIRTY_DAYS_MS - 5 * 24 * 60 * 60 * 1000))
    expect(expiresAt.getTime()).toBe(expected.getTime())
  })

  it('returns now for review past 30-day window', () => {
    const now = new Date('2025-06-01T12:00:00Z')
    const reviewedAt = new Date('2025-04-01T12:00:00Z') // 61 days ago

    const expiresAt = calculateExpiresAt(reviewedAt, now)

    expect(expiresAt.getTime()).toBe(now.getTime())
  })

  it('returns now + full window for review just posted', () => {
    const now = new Date('2025-06-01T12:00:00Z')
    const reviewedAt = new Date('2025-06-01T12:00:00Z')

    const expiresAt = calculateExpiresAt(reviewedAt, now)

    expect(expiresAt.getTime()).toBe(now.getTime() + THIRTY_DAYS_MS)
  })
})

describe('canTransitionReply', () => {
  it('allows draft → pending_approval', () => {
    expect(canTransitionReply('draft', 'pending_approval')).toBe(true)
  })

  it('allows draft → draft (in-place edit of an existing draft)', () => {
    expect(canTransitionReply('draft', 'draft')).toBe(true)
  })

  it('allows pending_approval → approved', () => {
    expect(canTransitionReply('pending_approval', 'approved')).toBe(true)
  })

  it('allows pending_approval → rejected', () => {
    expect(canTransitionReply('pending_approval', 'rejected')).toBe(true)
  })

  it('allows approved → published', () => {
    expect(canTransitionReply('approved', 'published')).toBe(true)
  })

  it('allows approved → publish_failed', () => {
    expect(canTransitionReply('approved', 'publish_failed')).toBe(true)
  })

  it('allows rejected → draft', () => {
    expect(canTransitionReply('rejected', 'draft')).toBe(true)
  })

  it('allows publish_failed → approved', () => {
    expect(canTransitionReply('publish_failed', 'approved')).toBe(true)
  })

  it('blocks draft → approved (must go through pending_approval)', () => {
    expect(canTransitionReply('draft', 'approved')).toBe(false)
  })

  it('blocks published → any', () => {
    expect(canTransitionReply('published', 'draft')).toBe(false)
    expect(canTransitionReply('published', 'approved')).toBe(false)
  })

  it('blocks rejected → pending_approval (must re-draft first)', () => {
    expect(canTransitionReply('rejected', 'pending_approval')).toBe(false)
  })
})

describe('MAX_REPLY_LENGTH', () => {
  it('is 4096', () => {
    expect(MAX_REPLY_LENGTH).toBe(4096)
  })
})
