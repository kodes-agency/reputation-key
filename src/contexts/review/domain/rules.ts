// Review context — domain rules

import type { StarRating } from './types'

const VALID_RATINGS = new Set([1, 2, 3, 4, 5] as const)

export const isValidRating = (n: number): n is StarRating => VALID_RATINGS.has(n as StarRating)

/**
 * Calculate expiresAt from reviewedAt using the 30-day retention window.
 * If the review is already past 30 days, returns `now` (expire immediately).
 */
export const calculateExpiresAt = (reviewedAt: Date, now: Date): Date => {
  const maxRetentionWindow = 30 * 24 * 60 * 60 * 1000
  const remainingRetention = maxRetentionWindow - (now.getTime() - reviewedAt.getTime())
  return remainingRetention > 0
    ? new Date(now.getTime() + remainingRetention)
    : now
}
