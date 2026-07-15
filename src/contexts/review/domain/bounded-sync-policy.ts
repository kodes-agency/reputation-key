// BETA-1 B1.7: Bounded sync policy for Google review ingestion.
//
// Defines page/time budgets for cursor-based sync and rules for
// source version advancement. A partial import resumes at its
// checkpoint rather than restarting or falsely reporting success.
//
// Used by: review sync jobs, reconciliation, notification-driven targeted sync.

/** Maximum number of pages per sync run before yielding back to the queue. */
export const MAX_PAGES_PER_RUN = 50

/** Maximum wall-clock time per sync run (ms) before checkpointing. */
export const MAX_RUN_DURATION_MS = 120_000 // 2 minutes

/** Maximum reviews per page from the Google API. */
export const PAGE_SIZE = 200

/** Time budget for a single Google API page request before timeout. */
export const PAGE_TIMEOUT_MS = 15_000

/**
 * Bounded sync checkpoint — persisted between sync runs so an
 * interrupted import resumes at the correct position.
 *
 * Stored in `review_sync_state.watermark_updated_at` + `next_incremental_at`.
 */
export type SyncCheckpoint = Readonly<{
  /** The cursor value (Google nextPageToken or last review timestamp). */
  cursor: string | null
  /** Number of pages processed in the current run. */
  pagesProcessed: number
  /** Total reviews processed in the current run. */
  reviewsProcessed: number
  /** Whether the sync has reached the end of available data. */
  hasMore: boolean
  /** When this checkpoint was recorded. */
  recordedAt: Date
}>

/**
 * Check if a sync run has exceeded its budgets and should checkpoint.
 */
export function shouldCheckpoint(pagesProcessed: number, runDurationMs: number): boolean {
  return pagesProcessed >= MAX_PAGES_PER_RUN || runDurationMs >= MAX_RUN_DURATION_MS
}

/**
 * Determine if a review should be upserted based on source version rules.
 *
 * Google timestamps are source truth. We upsert only when the source
 * version advances — i.e., the review was updated on Google since we
 * last fetched it.
 *
 * @param existingSourceUpdatedAt - When we last saw this review updated on Google
 * @param incomingSourceUpdatedAt - When Google says this review was last updated
 * @returns true if the incoming version is newer (should upsert)
 */
export function shouldUpsertReview(
  existingSourceUpdatedAt: Date | null,
  incomingSourceUpdatedAt: Date,
): boolean {
  if (existingSourceUpdatedAt === null) return true // new review
  return incomingSourceUpdatedAt.getTime() > existingSourceUpdatedAt.getTime()
}

/**
 * Classify a Google API error for retry/terminal decision.
 */
export type SyncErrorClass =
  | { kind: 'retryable'; reason: string; retryAfterMs?: number }
  | { kind: 'terminal'; reason: string }
  | { kind: 'reauth_required'; reason: string }

export function classifySyncError(statusCode: number, body?: string): SyncErrorClass {
  // Rate limited
  if (statusCode === 429) {
    return { kind: 'retryable', reason: 'rate_limited', retryAfterMs: 60_000 }
  }

  // Server errors
  if (statusCode >= 500) {
    return { kind: 'retryable', reason: 'server_error', retryAfterMs: 30_000 }
  }

  // Auth errors
  if (statusCode === 401) {
    return { kind: 'reauth_required', reason: 'token_expired_or_revoked' }
  }

  if (statusCode === 403) {
    // Could be scope issue or quota
    if (body?.includes('quota')) {
      return { kind: 'retryable', reason: 'quota_exceeded', retryAfterMs: 300_000 }
    }
    return { kind: 'terminal', reason: 'forbidden' }
  }

  // Not found — review/location deleted
  if (statusCode === 404) {
    return { kind: 'terminal', reason: 'not_found' }
  }

  // Conflict
  if (statusCode === 409) {
    return { kind: 'retryable', reason: 'conflict', retryAfterMs: 5_000 }
  }

  // Unknown — be conservative
  if (statusCode >= 400) {
    return { kind: 'terminal', reason: `client_error_${statusCode}` }
  }

  return { kind: 'retryable', reason: 'unknown', retryAfterMs: 10_000 }
}
