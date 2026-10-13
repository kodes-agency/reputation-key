// SourceContentPolicy — Google review-content lifecycle timing and policy version.
//
// Operational obligations are enforced at their owning boundaries. The policy
// carries no permission flag: a field no code consults is a claim, not a
// control (docs/BETA.md §2), and source-content-policy.test.ts pins the list.
//
// The whole object is hashed into the digest that binds a Review lifecycle
// recovery approval (reviewLifecyclePolicySha256), so adding or removing a
// field changes that digest and an approval prepared before it is refused.

export type SourceContentPolicy = Readonly<{
  /** Content source identifier. */
  readonly source: 'google'

  /** How long raw content may be cached before refresh or removal (ms). */
  readonly rawContentTtlMs: number

  /** Refresh is due before the TTL expires — safety margin for purge (ms). */
  readonly rawRefreshDueBeforeMs: number

  /** Policy version — increment when rules change. Stored with derived data. */
  readonly policyVersion: number
}>

const DAYS_MS = 24 * 60 * 60 * 1000

/**
 * Production source content policy derived from Google's written response.
 *
 * Based on: google-business-profile-ai-policy-response-2026-07-14.md
 * ADR: 0031
 */
export function createGoogleSourceContentPolicy(): SourceContentPolicy {
  return {
    source: 'google',
    rawContentTtlMs: 30 * DAYS_MS,
    rawRefreshDueBeforeMs: 25 * DAYS_MS,
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
