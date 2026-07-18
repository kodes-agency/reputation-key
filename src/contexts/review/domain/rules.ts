// Review context — domain rules

import { createHash } from 'node:crypto'
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
 *
 * @deprecated ADR 0031 / BQR-3: prefer `contentExpiresAt` from last successful
 * fetch. Kept for expand-phase dual clock until BQR-3.2 switches job readers.
 */
export const calculateExpiresAt = (reviewedAt: Date, now: Date): Date => {
  const maxRetentionWindow = 30 * 24 * 60 * 60 * 1000
  const remainingRetention = maxRetentionWindow - (now.getTime() - reviewedAt.getTime())
  return remainingRetention > 0 ? new Date(now.getTime() + remainingRetention) : now
}

/**
 * Stable SHA-256 of normalized, policy-controlled source fields.
 * Used to detect content-changing fetches vs mere refreshes (BQR-3.1/3.4).
 */
export function computeReviewContentHash(
  fields: Readonly<{
    rating: number
    text: string | null
    reviewerName: string | null
    languageCode: string | null
  }>,
): string {
  // Null-safe, order-stable canonical form (no JSON key reordering risk).
  const canonical = [
    String(fields.rating),
    fields.text ?? '',
    fields.reviewerName ?? '',
    fields.languageCode ?? '',
  ].join('\0')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/** Valid reply status transitions. Keys are current status, values are allowed next statuses.
 *  `draft → draft` is an explicit self-transition covering in-place edits of an existing draft
 *  (text changes without a status change), so `transitionReply` is the single authority for
 *  every reply write — including edits.
 *  `publish_failed → published` exists ONLY for the BQC-3.3 reconciliation path
 *  (reconcileReplyPublication): the provider confirms the reply already exists,
 *  healing an ambiguous publish outcome. It never skips approval. */
const REPLY_TRANSITIONS: Readonly<Record<ReplyStatus, ReadonlyArray<ReplyStatus>>> = {
  draft: ['draft', 'pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['published', 'publish_failed'],
  published: [],
  rejected: ['draft'],
  publish_failed: ['approved', 'published'],
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
