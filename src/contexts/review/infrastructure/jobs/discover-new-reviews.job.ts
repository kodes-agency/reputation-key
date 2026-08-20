// Review context — BullMQ job handler for discovering NEW Google reviews.
//
// The refresh sweep (refresh-expiring-reviews, BQC-1.5) only ever revisits
// reviews already stored, and only inside the 5-day window before their
// 30-day content TTL. A connected property therefore got synced once at
// import and then not again for ~25 days: a brand-new review had no path
// into the app unless the (dark) GBP Pub/Sub webhook was configured.
//
// This is that missing path. Same shape as the refresh sweep:
//   - keyset-cursor batches ordered by property id, bounded batch budget;
//   - a batch with an enqueue failure does NOT advance the cursor: the
//     failing property is deferred (so it cannot starve every later batch),
//     the failure is recorded, and the handler throws for the queue retry
//     (sync upserts are idempotent, so replay is safe);
//   - per-property due times live in review_sync_state.next_incremental_at,
//     so progress is durable without a sweep-run table and a property is
//     never polled more often than its interval.
//
// Content-free: identifiers, timestamps, counts, and an error class only.

import type { Job } from 'bullmq'
import type { Logger } from 'pino'

export const JOB_NAME = 'discover-new-reviews' as const

import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import type {
  ReviewDiscoveryCandidate,
  ReviewDiscoveryRepository,
} from '../../application/ports/review-discovery.repository'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

const DEFAULT_BATCH_SIZE = 200
const DEFAULT_MAX_BATCHES = 10

/**
 * Per-property minimum poll interval. The sweep FIRES every 15 minutes
 * (worker/index.ts); this is how long a property waits before it is polled
 * again, and it is what REVIEW_DISCOVERY_INTERVAL_MINUTES configures.
 */
export const DEFAULT_DISCOVERY_INTERVAL_MS = 15 * 60 * 1000

type DiscoverHandlerDeps = Readonly<{
  discoveryRepo: ReviewDiscoveryRepository
  queue: ReviewQueuePort
  clock: () => Date
  intervalMs?: number
  batchSize?: number
  maxBatches?: number
}>

type SweepState = {
  cursor: string | null
  batches: number
  seen: number
  enqueued: number
  enqueueFailedPropertyId: string | null
}

type BatchOutcome =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'processed'; cursor: string }>
  | Readonly<{ kind: 'enqueue_failed' }>

/**
 * Enqueue one bounded sync job per candidate, marking each property's next
 * due time as it goes. Stops at the first enqueue failure — the batch is
 * never acknowledged past it.
 */
async function enqueueCandidates(
  deps: DiscoverHandlerDeps,
  candidates: readonly ReviewDiscoveryCandidate[],
  state: SweepState,
  now: Date,
  nextDueAt: Date,
  logger: Logger,
): Promise<void> {
  for (const candidate of candidates) {
    try {
      await deps.queue.addSyncJob({
        propertyId: candidate.propertyId,
        organizationId: candidate.organizationId,
        connectionId: candidate.connectionId,
        locationName: candidate.locationName,
        initiator: { kind: 'system', id: 'sweep:review-discovery' },
        correlationId: `review-discovery:${candidate.propertyId}`,
      })
    } catch (err) {
      state.enqueueFailedPropertyId = candidate.propertyId
      logger.warn({ err }, 'Failed to enqueue discovery sync job')
      // Defer the failing property so it cannot re-consume the head of
      // every subsequent batch; best-effort, the throw is what matters.
      await deps.discoveryRepo
        .markDiscoveryDeferred(candidate.propertyId, now, nextDueAt, 'enqueue_failed')
        .catch(() => {})
      return
    }
    await deps.discoveryRepo.markDiscoveryScheduled(candidate.propertyId, now, nextDueAt)
    state.enqueued++
  }
}

/** Fetch and enqueue one batch. Never advances past a failure. */
async function processDiscoveryBatch(
  deps: DiscoverHandlerDeps,
  state: SweepState,
  options: Readonly<{
    batchSize: number
    now: Date
    nextDueAt: Date
    logger: Logger
  }>,
): Promise<BatchOutcome> {
  const batch = await deps.discoveryRepo.findDuePropertiesBatch(
    options.now,
    state.cursor,
    options.batchSize,
  )
  if (batch.length === 0) return { kind: 'empty' }

  state.batches++
  state.seen += batch.length

  await enqueueCandidates(
    deps,
    batch,
    state,
    options.now,
    options.nextDueAt,
    options.logger,
  )
  if (state.enqueueFailedPropertyId !== null) return { kind: 'enqueue_failed' }

  const last = batch[batch.length - 1]
  return { kind: 'processed', cursor: last.propertyId }
}

/** The bounded sweep loop — returns on empty/budget; throws on enqueue failure. */
async function runDiscoveryLoop(
  deps: DiscoverHandlerDeps,
  state: SweepState,
  options: Readonly<{
    batchSize: number
    maxBatches: number
    now: Date
    nextDueAt: Date
    logger: Logger
  }>,
): Promise<void> {
  for (;;) {
    if (state.batches >= options.maxBatches) return
    const outcome = await processDiscoveryBatch(deps, state, options)

    if (outcome.kind === 'empty') return

    if (outcome.kind === 'enqueue_failed') {
      throw new Error(
        `discovery sweep: enqueue failed for property ${state.enqueueFailedPropertyId} in batch ${state.batches} — cursor held`,
      )
    }

    state.cursor = outcome.cursor
  }
}

export const createDiscoverNewReviewsHandler = (deps: DiscoverHandlerDeps) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES
  const intervalMs = deps.intervalMs ?? DEFAULT_DISCOVERY_INTERVAL_MS

  return async (_job: Job) => {
    return trace('job.discoverNewReviews', async () => {
      const logger = getLogger()
      const now = deps.clock()
      const nextDueAt = new Date(now.getTime() + intervalMs)

      const state: SweepState = {
        cursor: null,
        batches: 0,
        seen: 0,
        enqueued: 0,
        enqueueFailedPropertyId: null,
      }

      try {
        await runDiscoveryLoop(deps, state, {
          batchSize,
          maxBatches,
          now,
          nextDueAt,
          logger,
        })
      } finally {
        logger.info(
          {
            candidatesSeen: state.seen,
            enqueued: state.enqueued,
            batchesProcessed: state.batches,
            budgetExhausted: state.batches >= maxBatches,
            intervalMs,
          },
          'Discover new reviews sweep finished',
        )
      }
    })
  }
}
