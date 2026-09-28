import type { JobsOptions } from 'bullmq'

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
 * before analysis began. Jumping the queue is safe: consumers are idempotent
 * and fenced, and concurrent dispatches never kept events in order anyway.
 *
 * One fact per switch, never a family that fans out. The Review Analysis
 * replay (`ai.review_analysis.backfill_requested`) was expedited too, but it
 * is one fact per eligible review — up to an import's 10,000 — and at the
 * front it held every notification fact already waiting behind all of them:
 * a new review's notice, a failed publish, an escalation. It takes its place
 * in line; with dispatch no longer rate-limited, an import's burst ahead of
 * it drains in seconds.
 */
export const EXPEDITED_DISPATCH_EVENT_TYPES: ReadonlySet<string> = new Set([
  'identity.merchant_ai.changed',
])

/**
 * How every dispatch of an outbox fact is added: the fact's id as the job id,
 * so a second add of a job Redis still holds is a no-op; the retry policy;
 * the expedite rule; bounded history.
 */
export function dispatchJobAddOptions(
  event: Readonly<{ id: string; eventType: string }>,
): JobsOptions {
  return {
    jobId: event.id,
    ...DISPATCH_JOB_OPTIONS,
    ...(EXPEDITED_DISPATCH_EVENT_TYPES.has(event.eventType) ? { lifo: true } : {}),
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  }
}
