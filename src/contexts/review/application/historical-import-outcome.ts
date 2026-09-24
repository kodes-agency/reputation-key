// Review context — what a reader is told when a Property's first Google
// history import ends.
//
// The snapshot run's failure taxonomy is execution vocabulary: twenty codes,
// most of which the discovery ladder retries by itself. A person only needs
// the answer that changes what they do next, so the codes collapse to the
// closed set the durable fact carries (ADR 0046, amended 2026-09-24).

import type { ReviewHistoryImportFailureReason } from '../domain/events'
import type { ReviewProviderSnapshotFailureCode } from './ports/review-provider-snapshot.repository'

/**
 * Codes that are NOT "we will try again". Everything absent from this map is
 * retried by the discovery ladder without anybody doing anything, so it must
 * not produce a notice that asks for action.
 */
const ACTIONABLE_REASONS: Readonly<
  Partial<Record<ReviewProviderSnapshotFailureCode, ReviewHistoryImportFailureReason>>
> = {
  authorization_changed: 'google_authorization',
  authorization_denied: 'google_authorization',
  source_changed: 'property_source_changed',
  stale_source: 'property_source_changed',
  page_cap_exceeded: 'location_too_large',
  review_cap_exceeded: 'location_too_large',
}

/** The closed reason a failed first history import is reported with. */
export const historyImportFailureReason = (
  code: ReviewProviderSnapshotFailureCode,
): ReviewHistoryImportFailureReason => ACTIONABLE_REASONS[code] ?? 'temporary'
