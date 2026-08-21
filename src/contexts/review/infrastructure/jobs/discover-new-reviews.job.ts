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
//     never polled more often than its interval;
//   - that interval is not flat: each property's next due time is priced on
//     the backoff ladder (domain/discovery-backoff.ts) from its own activity
//     evidence, so the quiet majority costs a fraction of the provider quota
//     a flat 15-minute interval used to spend on them.
//
// Content-free: identifiers, timestamps, counts, and an error class only.

import type { Job } from 'bullmq'
import type { Logger } from 'pino'

export const JOB_NAME = 'discover-new-reviews' as const

import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  type ReviewQueuePort,
} from '../../application/ports/review-queue.port'
import type {
  ReviewDiscoveryCandidate,
  ReviewDiscoveryRepository,
} from '../../application/ports/review-discovery.repository'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import {
  discoveryTierFor,
  nextDiscoveryDueAt,
  type DiscoveryBackoffTier,
} from '../../domain/discovery-backoff'

const DEFAULT_BATCH_SIZE = 200
const DEFAULT_MAX_BATCHES = 10

/**
 * BASE per-property poll interval — the hot rung of the backoff ladder. The
 * sweep FIRES every 15 minutes (worker/index.ts, a literal cadence); this is
 * the shortest a property ever waits before being polled again, and it is
 * what REVIEW_DISCOVERY_INTERVAL_MINUTES configures. A property with no
 * recent activity waits a MULTIPLE of it — see domain/discovery-backoff.ts.
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
  /** Content-free ladder telemetry: how many polls each rung cost this run. */
  enqueuedByTier: Record<DiscoveryBackoffTier, number>
  enqueueFailedPropertyId: string | null
}

type BatchOutcome =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'processed'; cursor: string }>
  | Readonly<{ kind: 'enqueue_failed' }>

/**
 * Enqueue one bounded sync job per candidate, marking each property's next
 * due time as it goes. Each property's next due time is priced on the backoff
 * ladder from its OWN activity evidence, so a burst-active property keeps the
 * base interval while a property quiet for days backs off.
 *
 * Stops at the first enqueue failure — the batch is never acknowledged past
 * it. A deferral after a failure uses the BASE interval, not the ladder: the
 * failure says nothing about the property's liveness, and a broken enqueue
 * should be retried promptly rather than parked for six hours.
 */
async function enqueueCandidates(
  deps: DiscoverHandlerDeps,
  candidates: readonly ReviewDiscoveryCandidate[],
  state: SweepState,
  options: Readonly<{ now: Date; baseIntervalMs: number; logger: Logger }>,
): Promise<void> {
  const { now, baseIntervalMs, logger } = options
  for (const candidate of candidates) {
    try {
      await deps.queue.addSyncJob({
        propertyId: candidate.propertyId,
        organizationId: candidate.organizationId,
        connectionId: candidate.connectionId,
        locationName: candidate.locationName,
        initiator: { kind: 'system', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
        correlationId: `review-discovery:${candidate.propertyId}`,
      })
    } catch (err) {
      state.enqueueFailedPropertyId = candidate.propertyId
      logger.warn({ err }, 'Failed to enqueue discovery sync job')
      // Defer the failing property so it cannot re-consume the head of
      // every subsequent batch; best-effort, the throw is what matters.
      await deps.discoveryRepo
        .markDiscoveryDeferred(
          candidate.propertyId,
          now,
          new Date(now.getTime() + baseIntervalMs),
          'enqueue_failed',
        )
        .catch(() => {})
      return
    }
    const tier = discoveryTierFor(candidate.activity, now)
    await deps.discoveryRepo.markDiscoveryScheduled(
      candidate.propertyId,
      now,
      nextDiscoveryDueAt(candidate.activity, now, baseIntervalMs),
    )
    state.enqueued++
    state.enqueuedByTier[tier]++
  }
}

/** Fetch and enqueue one batch. Never advances past a failure. */
async function processDiscoveryBatch(
  deps: DiscoverHandlerDeps,
  state: SweepState,
  options: Readonly<{
    batchSize: number
    now: Date
    baseIntervalMs: number
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

  await enqueueCandidates(deps, batch, state, {
    now: options.now,
    baseIntervalMs: options.baseIntervalMs,
    logger: options.logger,
  })
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
    baseIntervalMs: number
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
  const baseIntervalMs = deps.intervalMs ?? DEFAULT_DISCOVERY_INTERVAL_MS

  return async (_job: Job) => {
    return trace('job.discoverNewReviews', async () => {
      const logger = getLogger()
      const now = deps.clock()

      const state: SweepState = {
        cursor: null,
        batches: 0,
        seen: 0,
        enqueued: 0,
        enqueuedByTier: { hot: 0, warm: 0, cold: 0 },
        enqueueFailedPropertyId: null,
      }

      try {
        await runDiscoveryLoop(deps, state, {
          batchSize,
          maxBatches,
          now,
          baseIntervalMs,
          logger,
        })
      } finally {
        logger.info(
          {
            candidatesSeen: state.seen,
            enqueued: state.enqueued,
            batchesProcessed: state.batches,
            budgetExhausted: state.batches >= maxBatches,
            baseIntervalMs,
            // Ladder shape for this run: rising cold/warm counts are the
            // whole point — they are polls the flat interval used to spend.
            enqueuedHot: state.enqueuedByTier.hot,
            enqueuedWarm: state.enqueuedByTier.warm,
            enqueuedCold: state.enqueuedByTier.cold,
          },
          'Discover new reviews sweep finished',
        )
      }
    })
  }
}
