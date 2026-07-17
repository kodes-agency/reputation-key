// Review source content lifecycle — implements Google's 30-day retention
// policy (PRE17B / ADR 0031).
//
// Calculates content expiry timestamps, identifies reviews due for refresh
// or purge, and classifies content status against the SourceContentPolicy.
//
// BQR-3.1: write paths use calculateContentExpiry + computeReviewContentHash.
// BQR-3.2: jobs use classifyReviewsForRefresh / checkContentStatus.

import type { SourceContentPolicy } from '#/shared/domain/source-content-policy'
import {
  contentExpiresAtFromFetch,
  contentRefreshDueThreshold,
  contentRefreshLeadMs,
  createGoogleSourceContentPolicy,
} from '#/shared/domain/source-content-policy'
import { computeReviewContentHash } from '../domain/rules'

export { computeReviewContentHash, contentRefreshDueThreshold, contentRefreshLeadMs }

const DEFAULT_POLICY = createGoogleSourceContentPolicy()

/**
 * BQC-1.2: the read-time eligibility rule (ADR 0031). Content is servable
 * only while a successful-fetch clock exists and has not passed. Clock-less
 * rows fail closed — local reads, scheduler touches, copies, backups, and
 * model calls never extend the clock.
 */
export function isContentEligibleForRead(
  contentExpiresAt: Date | null,
  now: Date,
): boolean {
  return contentExpiresAt !== null && contentExpiresAt > now
}

export type ReviewContentStatus = 'fresh' | 'refresh_due' | 'expired' | 'no_content'

export type ReviewContentCheck = Readonly<{
  status: ReviewContentStatus
  contentExpiresAt: Date | null
  lastFetchedAt: Date | null
  daysUntilExpiry: number | null
}>

/**
 * Calculate the content expiry date for a review based on when it was
 * last fetched from Google and the source content policy TTL.
 */
export function calculateContentExpiry(
  lastFetchedAt: Date | null,
  policy: SourceContentPolicy = DEFAULT_POLICY,
): Date | null {
  if (!lastFetchedAt) return null
  return contentExpiresAtFromFetch(lastFetchedAt, policy)
}

/**
 * Check the content status of a review against the policy.
 */
export function checkContentStatus(
  lastFetchedAt: Date | null,
  contentExpiresAt: Date | null,
  now: Date = new Date(),
  policy: SourceContentPolicy = DEFAULT_POLICY,
): ReviewContentCheck {
  if (!lastFetchedAt || !contentExpiresAt) {
    return {
      status: 'no_content',
      contentExpiresAt: null,
      lastFetchedAt: null,
      daysUntilExpiry: null,
    }
  }

  const refreshDueAt = new Date(lastFetchedAt.getTime() + policy.rawRefreshDueBeforeMs)
  const msPerDay = 24 * 60 * 60 * 1000
  const daysUntilExpiry = Math.ceil(
    (contentExpiresAt.getTime() - now.getTime()) / msPerDay,
  )

  let status: ReviewContentStatus
  if (now > contentExpiresAt) {
    status = 'expired'
  } else if (now > refreshDueAt) {
    status = 'refresh_due'
  } else {
    status = 'fresh'
  }

  return { status, contentExpiresAt, lastFetchedAt, daysUntilExpiry }
}

/**
 * Classify a batch of reviews for the refresh/purge job.
 */
export function classifyReviewsForRefresh(
  reviews: ReadonlyArray<
    Readonly<{
      id: string
      lastFetchedAt: Date | null
      contentExpiresAt: Date | null
    }>
  >,
  now: Date = new Date(),
  policy: SourceContentPolicy = DEFAULT_POLICY,
): Readonly<{
  fresh: readonly string[]
  refreshDue: readonly string[]
  expired: readonly string[]
}> {
  const fresh: string[] = []
  const refreshDue: string[] = []
  const expired: string[] = []

  for (const review of reviews) {
    const check = checkContentStatus(
      review.lastFetchedAt,
      review.contentExpiresAt,
      now,
      policy,
    )
    switch (check.status) {
      case 'fresh':
        fresh.push(review.id)
        break
      case 'refresh_due':
        refreshDue.push(review.id)
        break
      case 'expired':
        expired.push(review.id)
        break
    }
  }

  return { fresh, refreshDue, expired }
}
