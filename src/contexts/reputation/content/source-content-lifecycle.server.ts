// Review source content lifecycle — implements Google's 30-day retention
// policy (ADR 0031): the read-time eligibility rule, the refresh threshold and
// the content hash write paths use.

import { contentRefreshDueThreshold } from '#/shared/domain/source-content-policy'
import { computeReviewContentHash } from '../domain/review-rules'

export { computeReviewContentHash, contentRefreshDueThreshold }

/**
 * The read-time eligibility rule (ADR 0031). Content is servable
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
