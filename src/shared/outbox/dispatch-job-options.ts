import type { JobsOptions } from 'bullmq'

export const OUTBOX_DELIVERY_KIND = 'outbox-delivery' as const

// Expire before BullMQ's recovery lock; the session advisory lock protects
// live consumers even when their execution outlasts this lease.
export const OUTBOX_DELIVERY_LEASE_MS = 60_000

// Four windows of eight execution claims; transport spends no budget.
export const OUTBOX_DELIVERY_MAX_ATTEMPTS = 32

export function deliveryRetryDelayMs(attempt: number): number {
  const turn = (attempt - 1) % 8
  return turn === 7
    ? 2 * 60 * 60_000 * 2 ** (Math.floor(attempt / 8) - 1)
    : 30_000 * 2 ** turn
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
