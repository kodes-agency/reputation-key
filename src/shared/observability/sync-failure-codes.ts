// The codes a Review sync can fail with, as the health snapshot names them.
//
// review_sync_state.error_class is plain text, and the health snapshot is
// counts and ages only (ADR 0030/0048), so a failing sync is counted under one
// of these codes or under `other`; the stored text itself never leaves the
// database. The list mirrors what the discovery repository writes
// (ReviewProviderSnapshotFailureCode plus `enqueue_failed`); a review-context
// test fails if the two drift. `cursor_lost` and `listing_changed` are listed
// for completeness: the sync job restarts those runs without recording a
// failure, so they are never stored; `connection_unusable` is the same (a
// connection waiting for a reconnect ends the run quietly, with no stored
// failure, because the reconnect notice is the signal). `total_changed`, `average_changed` and
// `confirmation_set_changed` reach here only when a Property's listing keeps
// moving under run after run; the first two runs of such a move are
// `listing_changed`. So does `duplicate_resource` when a review sits on two
// pages of a scan, but a page that lists a review twice is stored as it on
// its first run (ADR 0055, note 2026-10-20). `run_already_failed` is not
// listed: it is the sync job's returned outcome for a step that finds its run
// already failed, never a code of a run or of `error_class` (ADR 0055, note
// 2026-10-25).

export const SYNC_FAILURE_CODES = [
  'source_changed',
  'authorization_changed',
  'authorization_denied',
  'connection_unusable',
  'runtime_unavailable',
  'stale_source',
  'provider_failure',
  'cursor_failure',
  'cursor_lost',
  'malformed_page',
  'total_changed',
  'average_changed',
  'duplicate_resource',
  'resource_collision',
  'review_mutation',
  'page_cap_exceeded',
  'review_cap_exceeded',
  'set_mismatch',
  'confirmation_deadline_elapsed',
  'confirmation_set_changed',
  'listing_changed',
  'observation_failed',
  'enqueue_failed',
] as const

/** Where a failing sync's code goes when it is not one of the above. */
export const OTHER_SYNC_FAILURE_CODE = 'other'

const KNOWN: ReadonlySet<string> = new Set(SYNC_FAILURE_CODES)

/** The code to count a stored `error_class` under. */
export function syncFailureCode(errorClass: string): string {
  return KNOWN.has(errorClass) ? errorClass : OTHER_SYNC_FAILURE_CODE
}
