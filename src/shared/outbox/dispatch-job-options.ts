/**
 * Domain-event dispatch retry policy.
 *
 * Jobs on this queue are event-typed rather than job-catalogue-typed, so every
 * producer of a canonical or accelerated delivery must use this contract.
 * Eight attempts are required because Review Analysis can consume pre-provider
 * retries and only terminal-settles a provider failure on its fourth attempt.
 * The 15-minute domain horizon remains the terminal authority: the minimum
 * exponential delay puts attempt seven after that horizon, with one attempt to
 * spare. This budget is recovery, not ordering; the backfill chain wakes N+1
 * when N settles instead of waiting for these retries to align by chance.
 */
export const DISPATCH_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000, jitter: 0.5 },
} as const

/**
 * Event types a manager is watching, published to the front of the dispatch
 * queue (BullMQ `lifo`). A Google import publishes about four events per
 * review, so switching AI on during an import used to wait behind that burst
 * twice — for the enrollment, then for its replay — about 70 seconds for 96
 * reviews before analysis began. Jumping the queue is safe: consumers are
 * idempotent and fenced, and 20 concurrent dispatches never kept events in
 * order anyway.
 */
export const EXPEDITED_DISPATCH_EVENT_TYPES: ReadonlySet<string> = new Set([
  'identity.merchant_ai.changed',
  'ai.review_analysis.backfill_requested',
])
