// Review context — domain rules

import type { StarRating, ReplyStatus, Reply } from './types'
import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { ReviewError } from './errors'
import { reviewError } from './errors'

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

/** Valid reply status transitions. Keys are current status, values are allowed next statuses.
 *  `draft → draft` is an explicit self-transition covering in-place edits of an existing draft
 *  (text changes without a status change), so `transitionReply` is the single authority for
 *  every reply write — including edits. */
const REPLY_TRANSITIONS: Readonly<Record<ReplyStatus, ReadonlyArray<ReplyStatus>>> = {
  draft: ['draft', 'pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['published', 'publish_failed'],
  published: [],
  rejected: ['draft'],
  publish_failed: ['approved'],
}

export const canTransitionReply = (current: ReplyStatus, next: ReplyStatus): boolean =>
  REPLY_TRANSITIONS[current]?.includes(next) ?? false

/**
 * Transition a reply to a new status.
 * Validates the transition is allowed and produces a new Reply with updated status/timestamp.
 */
export const transitionReply = (
  reply: Reply,
  nextStatus: ReplyStatus,
  now: Date,
): Result<Reply, ReviewError> => {
  if (!canTransitionReply(reply.status, nextStatus)) {
    return err(
      reviewError(
        'invalid_transition',
        `Cannot transition reply from '${reply.status}' to '${nextStatus}'`,
      ),
    )
  }

  return ok({
    ...reply,
    status: nextStatus,
    updatedAt: now,
    ...(nextStatus === 'published' ? { publishedAt: now } : {}),
  })
}

/** Shared across domain, server functions, and UI. */
export const MAX_REPLY_LENGTH = 4096
