// SourceContentPolicy — Google review-content lifecycle timing and policy version.
//
// Operational obligations are enforced at their owning boundaries.

export type SourceContentPolicy = Readonly<{
  /** Content source identifier. */
  readonly source: 'google'

  /** How long raw content may be cached before refresh or removal (ms). */
  readonly rawContentTtlMs: number

  /** Refresh is due before the TTL expires — safety margin for purge (ms). */
  readonly rawRefreshDueBeforeMs: number

  /** Permitted: per-review sentiment, category, priority analysis (one property). */
  readonly mayAnalyzePerReview: boolean

  /** Permitted: per-property themes, trends, summaries (one property). */
  readonly mayAggregatePerProperty: boolean

  /** Permitted: retaining derived metadata beyond raw TTL (separate retention). */
  readonly mayRetainDerivedMetadata: boolean

  /** Policy version — increment when rules change. Stored with derived data. */
  readonly policyVersion: number
}>

const DAYS_MS = 24 * 60 * 60 * 1000

/**
 * Production source content policy derived from Google's written response.
 *
 * Based on: google-business-profile-ai-policy-response-2026-07-14.md
 * ADR: 0031 (pending formal approval)
 */
export function createGoogleSourceContentPolicy(): SourceContentPolicy {
  return {
    source: 'google',
    rawContentTtlMs: 30 * DAYS_MS,
    rawRefreshDueBeforeMs: 25 * DAYS_MS,
    mayAnalyzePerReview: true,
    mayAggregatePerProperty: true,
    mayRetainDerivedMetadata: true,
    policyVersion: 1,
  }
}

/**
 * Content expiry is always derived from the last successful Google fetch
 * (ADR 0031). Publication time must not extend or reset this clock.
 */
export function contentExpiresAtFromFetch(
  lastFetchedAt: Date,
  policy: SourceContentPolicy = createGoogleSourceContentPolicy(),
): Date {
  return new Date(lastFetchedAt.getTime() + policy.rawContentTtlMs)
}

/**
 * Lead time before hard expiry when refresh is due
 * (`rawContentTtlMs - rawRefreshDueBeforeMs`, typically 5 days).
 */
function contentRefreshLeadMs(
  policy: SourceContentPolicy = createGoogleSourceContentPolicy(),
): number {
  return policy.rawContentTtlMs - policy.rawRefreshDueBeforeMs
}

/**
 * Upper bound for content_expires_at scans: refresh candidates with
 * contentExpiresAt in (now, now + lead].
 */
export function contentRefreshDueThreshold(
  now: Date,
  policy: SourceContentPolicy = createGoogleSourceContentPolicy(),
): Date {
  return new Date(now.getTime() + contentRefreshLeadMs(policy))
}
