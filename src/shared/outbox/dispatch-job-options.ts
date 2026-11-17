import type { JobsOptions } from 'bullmq'
import { PrerequisiteNotReadyError } from './prerequisite-not-ready'

export const OUTBOX_DELIVERY_KIND = 'outbox-delivery' as const

// Expire before BullMQ's recovery lock; the session advisory lock protects
// live consumers even when their execution outlasts this lease.
export const OUTBOX_DELIVERY_LEASE_MS = 60_000

// Four windows of eight execution claims; transport spends no budget.
export const OUTBOX_DELIVERY_MAX_ATTEMPTS = 32

const PREREQUISITE_RETRY_STEP_MS = 5_000
const PREREQUISITE_RETRY_MAX_MS = 60_000

export function deliveryRetryDelayMs(attempt: number): number {
  const turn = (attempt - 1) % 8
  return turn === 7
    ? 2 * 60 * 60_000 * 2 ** (Math.floor(attempt / 8) - 1)
    : 30_000 * 2 ** turn
}

/**
 * Wait before retrying a consumer whose prerequisite is not ready yet: a few
 * seconds at first, growing to a minute, so a short ordering race resolves
 * quickly and a longer wait does not spend the attempt budget.
 */
export function prerequisiteRetryDelayMs(attempt: number): number {
  return Math.min(PREREQUISITE_RETRY_STEP_MS * attempt, PREREQUISITE_RETRY_MAX_MS)
}

// About six minutes of quiet waiting. Past it the wait is no longer an
// ordering race (a lost job or a stuck producer looks the same), so it is
// reported as an ordinary failure.
export const PREREQUISITE_QUIET_ATTEMPTS = 12

/**
 * A prerequisite wait that has outlasted its quiet window becomes an ordinary
 * error carrying the wait as its cause; anything else passes through.
 */
export function escalateStalePrerequisiteWait(error: unknown, attempt: number): unknown {
  if (!(error instanceof PrerequisiteNotReadyError)) return error
  if (attempt < PREREQUISITE_QUIET_ATTEMPTS) return error
  return new Error(
    `Outbox consumer prerequisite still not ready after ${attempt} attempts`,
    { cause: error },
  )
}

export function deliveryWorkJobOptions(workId: string, eventType?: string): JobsOptions {
  return {
    jobId: `${workId}-initial`,
    attempts: 1,
    ...(eventType && EXPEDITED_DISPATCH_EVENT_TYPES.has(eventType) ? { lifo: true } : {}),
    removeOnComplete: true,
    removeOnFail: true,
  }
}

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
