// The retry schedule's bounds, kept apart from the Node-only provider call so
// browser-reachable code can floor a hint without importing it.

export const GOOGLE_RETRY_MIN_MS = 5_000
export const GOOGLE_RETRY_MAX_MS = 300_000

/**
 * Floor an already-parsed retry hint onto the same 5s..300s schedule as
 * `googleRetryDelayMs`. The gateway reports milliseconds rather than a header,
 * and a missing or zero hint must still produce a real wait: surfacing "retry
 * now" told the caller to wait while enabling the action immediately.
 */
export function googleRetryFloorMs(retryAfterMs: number | null): number {
  if (retryAfterMs === null || !Number.isSafeInteger(retryAfterMs)) {
    return GOOGLE_RETRY_MIN_MS
  }
  return Math.min(GOOGLE_RETRY_MAX_MS, Math.max(GOOGLE_RETRY_MIN_MS, retryAfterMs))
}
