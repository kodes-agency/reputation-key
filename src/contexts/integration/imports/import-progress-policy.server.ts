const ACTIVE_STATUSES: Readonly<Record<string, true>> = { queued: true, processing: true }

/**
 * Progress polling backs off on parent *staleness*, not elapsed total. Every
 * committed item advance refreshes `updatedAt` and returns the client to the fast
 * interval, while a parent that stops moving decays to the cap instead of costing
 * two queries plus an authorization round-trip per retry candidate every second
 * for as long as the tab stays open.
 */
const PROGRESS_POLL_FAST_MS = 1_000
const PROGRESS_POLL_MEDIUM_MS = 5_000
/** Cap. No active parent is ever polled less often than this. */
const PROGRESS_POLL_SLOW_MS = 15_000
const PROGRESS_POLL_FAST_UNTIL_STALE_MS = 30_000
const PROGRESS_POLL_MEDIUM_UNTIL_STALE_MS = 120_000

/**
 * Pure poll-interval hint. `null` means "stop polling": the parent is terminal.
 * The client honours this value verbatim, so all backoff policy lives here.
 */
export function googleImportProgressPollAfterMs(
  status: string,
  updatedAtMs: number,
  nowMs: number,
): number | null {
  if (ACTIVE_STATUSES[status] !== true) return null
  const staleMs = nowMs - updatedAtMs
  // A future or unusable `updatedAt` must not buy a slower interval than a fresh
  // one, so anything below the first threshold — including negatives — is fast.
  if (!Number.isFinite(staleMs) || staleMs < PROGRESS_POLL_FAST_UNTIL_STALE_MS) {
    return PROGRESS_POLL_FAST_MS
  }
  if (staleMs < PROGRESS_POLL_MEDIUM_UNTIL_STALE_MS) return PROGRESS_POLL_MEDIUM_MS
  return PROGRESS_POLL_SLOW_MS
}
