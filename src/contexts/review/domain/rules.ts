// Review context — domain rules

import type { StarRating, ReplyStatus } from './types'

const VALID_RATINGS = new Set([1, 2, 3, 4, 5] as const)

export const isValidRating = (n: number): n is StarRating =>
  VALID_RATINGS.has(n as StarRating)

/**
 * Calculate expiresAt from reviewedAt using the 30-day retention window.
 * If the review is already past 30 days, returns `now` (expire immediately).
 */
export const calculateExpiresAt = (reviewedAt: Date, now: Date): Date => {
  const maxRetentionWindow = 30 * 24 * 60 * 60 * 1000
  const remainingRetention = maxRetentionWindow - (now.getTime() - reviewedAt.getTime())
  return remainingRetention > 0 ? new Date(now.getTime() + remainingRetention) : now
}

/** Valid reply status transitions. Keys are current status, values are allowed next statuses. */
const REPLY_TRANSITIONS: Readonly<Record<ReplyStatus, ReadonlyArray<ReplyStatus>>> = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['published', 'publish_failed'],
  published: [],
  rejected: ['draft'],
  publish_failed: ['approved'],
}

export const canTransitionReply = (current: ReplyStatus, next: ReplyStatus): boolean =>
  REPLY_TRANSITIONS[current]?.includes(next) ?? false

/** Shared across domain, server functions, and UI. */
export const MAX_REPLY_LENGTH = 4096
