/**
 * Inbox-owned budget for manager-triggered "check this review on Google" reads.
 *
 * Each call spends one slot in a fixed window under a key the use case builds
 * (organization and review ids only, never content). The adapter maps the
 * shared rate limiter onto the three answers the use case acts on, so the use
 * case never learns about Redis, windows' storage, or fail-closed policy.
 */

export type GoogleCheckRateLimit = Readonly<{
  maxRequests: number
  windowSeconds: number
}>

export type GoogleCheckRateLimitDecision =
  /** The slot was free and is now spent. */
  | 'allowed'
  /** The budget for this key is used up until its window ends. */
  | 'limited'
  /** The limiter itself could not answer (it fails closed in production). */
  | 'unavailable'

export type GoogleCheckRateLimitPort = Readonly<{
  /** Never throws: a limiter failure is `unavailable`. */
  consume(key: string, limit: GoogleCheckRateLimit): Promise<GoogleCheckRateLimitDecision>
}>
