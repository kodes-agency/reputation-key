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
//     a flat 15-minute interval used to spend on them;
//   - the jobs a sweep enqueues do not all start at once. Each is handed to
//     the queue with a START DELAY drawn from a stable hash of its property
//     id, inside DISCOVERY_SPREAD_WINDOW_MS (10 minutes: the 15-minute sweep
//     cadence less the sweep's own 5-minute timeout; domain/discovery-spread.ts).
//     The snapshot runs of one sweep share a per-credential reviews.list quota
//     of 30 calls a minute, and a connection with a few dozen properties spent
//     it in the sweep's first seconds. Only this sweep spreads: push, import
//     and user-initiated syncs enqueue with no delay.
//     The delay moves when a job STARTS, never when its property is next DUE:
//     next_incremental_at is still written from the sweep's own time, so the
//     offset cannot push a property past the next sweep (dating it from the
//     delayed start would halve a hot property's polling), and because the
//     offset is the same on every sweep, consecutive polls stay exactly one
//     due-interval apart. The window is clamped strictly below the cadence
//     and the base interval, so a delayed job has always started before the
//     earliest instant a later sweep can enqueue the same property again:
//     nothing is ever waiting twice, and the sweep's queue behaviour (no job
//     id) is exactly what it was.
//
//   - a look does not always run the full snapshot. ADR 0055 decision 5 only
//     asks that a quiet healthy property is RECONCILED within six hours, and
//     push delivers new reviews in between, so a look that finds a completed
//     reconciliation (the facts table's evaluated_at, current source epoch)
//     inside that window writes the next look's date and enqueues nothing
//     (domain/discovery-reconciliation.ts). It is only for the sweep's own
//     looks: push, import, refresh and failure retries enqueue as before. A
//     property with an outstanding failure, no reconciliation yet, or no push
//     configured (the sweep is then the only path for new reviews) runs full.
//     The window is six hours unless REVIEW_RECONCILE_WITHIN_HOURS widens it.
//
//   - a SKIPPED look is not an empty one when head checks are on
//     (REVIEW_HEAD_CHECKS=dark or persist). Google documents page 1 of
//     reviews.list, newest-updated first, as always accurate, so the sweep
//     enqueues one head job for the Property (one call; dark reads and compares
//     and changes nothing, persist also stores what differs) and dates the next
//     look at now + the ladder interval, instead
//     of the single wake-up near the six-hour deadline. The head enqueue is
//     best-effort: a failure is logged and counted and never holds the sweep.
//     With head checks off the skip is exactly the one described above.
//
// Content-free: identifiers, timestamps, counts, and an error class only.

import type { Job } from 'bullmq'

export const JOB_NAME = 'discover-new-reviews' as const

import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  type ReviewHeadCheckQueuePort,
  type ReviewQueuePort,
} from '../../application/ports/review-queue.port'
import type {
  ReviewDiscoveryCandidate,
  ReviewDiscoveryRepository,
} from '../../application/ports/review-discovery.repository'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import {
  discoveryIntervalMs,
  discoveryTierFor,
  nextDiscoveryDueAt,
  type DiscoveryBackoffTier,
} from '../../domain/discovery-backoff'
import {
  discoveryLookFor,
  type DiscoveryFullReason,
} from '../../domain/discovery-reconciliation'
import {
  discoverySpreadDelayMs,
  discoverySpreadWindowMs,
} from '../../domain/discovery-spread'
import { headCheckJobId, type ReviewHeadChecksMode } from '../../domain/head-check'

const DEFAULT_BATCH_SIZE = 200
const DEFAULT_MAX_BATCHES = 10

/**
 * BASE per-property poll interval — the hot rung of the backoff ladder. The
 * sweep FIRES every 15 minutes (`every:900000` in the job catalogue, mirrored
 * as DISCOVERY_SWEEP_CADENCE_MS); this is the shortest a property ever waits
 * before being polled again, and it is what REVIEW_DISCOVERY_INTERVAL_MINUTES
 * configures. A property with no recent activity waits a MULTIPLE of it — see
 * domain/discovery-backoff.ts.
 */
export const DEFAULT_DISCOVERY_INTERVAL_MS = 15 * 60 * 1000

type DiscoverHandlerDeps = Readonly<{
  discoveryRepo: ReviewDiscoveryRepository
  queue: ReviewQueuePort
  clock: () => Date
  logger: Pick<LoggerPort, 'info' | 'warn'>
  intervalMs?: number
  batchSize?: number
  maxBatches?: number
  /**
   * Width of the window a sweep's sync jobs start over. Defaults to
   * DISCOVERY_SPREAD_WINDOW_MS and is always clamped below the sweep cadence
   * and the base interval; 0 starts every job immediately.
   */
  spreadWindowMs?: number
  /**
   * Skip the full snapshot for a property reconciled inside the six-hour
   * window. Defaults to OFF, so a caller that omits it keeps today's cadence of
   * a full look every time. The composition passes true only when the kill
   * switch is on and push is configured.
   */
  skipRecentlyReconciled?: boolean
  /**
   * `dark` follows every skipped look with a head job. Defaults to `off`, which
   * is the skip rule alone. Needs `headCheckQueue`; without it the mode is off.
   */
  headChecks?: ReviewHeadChecksMode
  headCheckQueue?: ReviewHeadCheckQueuePort
  /**
   * How recent a completed reconciliation must be for a look to skip, in
   * milliseconds (`REVIEW_RECONCILE_WITHIN_HOURS`). Defaults to six hours.
   */
  reconcileWithinMs?: number
}>

type SweepState = {
  cursor: string | null
  batches: number
  seen: number
  enqueued: number
  /** Content-free ladder telemetry: how many polls each rung cost this run. */
  enqueuedByTier: Record<DiscoveryBackoffTier, number>
  /** Looks that enqueued nothing because a recent reconciliation covers them. */
  skippedByTier: Record<DiscoveryBackoffTier, number>
  /** Why each full look was full. */
  fullByReason: Record<DiscoveryFullReason, number>
  /** Head jobs a skipped look handed to the queue, and those it could not. */
  headChecksEnqueued: number
  headChecksFailed: number
  enqueueFailedPropertyId: string | null
}

type BatchOutcome =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'processed'; cursor: string }>
  | Readonly<{ kind: 'enqueue_failed' }>

type CandidateOptions = Readonly<{
  now: Date
  baseIntervalMs: number
  spreadWindowMs: number
  skipEnabled: boolean
  headEnabled: boolean
  logger: DiscoverHandlerDeps['logger']
}>

/**
 * The head job of a skipped look: one read of Google's newest page, started
 * inside the same spread window as the sweep's snapshots so one sweep's heads
 * do not spend the reviews quota together. Best-effort: the look is already
 * dated, so a queue failure is counted and logged, never thrown.
 */
async function enqueueHeadCheck(
  deps: DiscoverHandlerDeps,
  candidate: ReviewDiscoveryCandidate,
  state: SweepState,
  options: CandidateOptions,
): Promise<void> {
  if (!deps.headCheckQueue) return
  const { now, baseIntervalMs, spreadWindowMs, logger } = options
  const delayMs = discoverySpreadDelayMs(candidate.propertyId, spreadWindowMs)
  try {
    await deps.headCheckQueue.addHeadCheckJob(
      {
        mode: 'head',
        propertyId: candidate.propertyId,
        organizationId: candidate.organizationId,
        connectionId: candidate.connectionId,
        locationName: candidate.locationName,
        initiator: { kind: 'system', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
        correlationId: `review-head:${candidate.propertyId}`,
      },
      {
        jobId: headCheckJobId(candidate.propertyId, now, baseIntervalMs),
        ...(delayMs > 0 ? { delayMs } : {}),
      },
    )
    state.headChecksEnqueued++
  } catch (err) {
    state.headChecksFailed++
    logger.warn({ err }, 'Failed to enqueue review head check job')
  }
}

/** The full look: spread the start, enqueue, date the next look. */
async function enqueueFullLook(
  deps: DiscoverHandlerDeps,
  candidate: ReviewDiscoveryCandidate,
  state: SweepState,
  options: CandidateOptions,
): Promise<'enqueued' | 'failed'> {
  const { now, baseIntervalMs, spreadWindowMs, logger } = options
  // A zero delay is left out entirely so the job options stay what they
  // were before the spread existed.
  const delayMs = discoverySpreadDelayMs(candidate.propertyId, spreadWindowMs)
  try {
    await deps.queue.addSyncJob(
      {
        propertyId: candidate.propertyId,
        organizationId: candidate.organizationId,
        connectionId: candidate.connectionId,
        locationName: candidate.locationName,
        initiator: { kind: 'system', id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
        correlationId: `review-discovery:${candidate.propertyId}`,
      },
      delayMs > 0 ? { delayMs } : undefined,
    )
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
    return 'failed'
  }
  const tier = discoveryTierFor(candidate.activity, now)
  await deps.discoveryRepo.markDiscoveryScheduled(
    candidate.propertyId,
    now,
    nextDiscoveryDueAt(candidate.activity, now, baseIntervalMs),
  )
  state.enqueued++
  state.enqueuedByTier[tier]++
  return 'enqueued'
}

/**
 * One look per candidate. The rule decides between the full look (today's
 * path, unchanged) and a skip, which only dates the next look.
 *
 * Returns false at the first enqueue failure — the batch is never
 * acknowledged past it.
 */
async function lookAtCandidate(
  deps: DiscoverHandlerDeps,
  candidate: ReviewDiscoveryCandidate,
  state: SweepState,
  options: CandidateOptions,
): Promise<boolean> {
  const { now, baseIntervalMs, skipEnabled, headEnabled } = options
  const look = discoveryLookFor({
    lastReconciledAt: candidate.lastReconciledAt,
    hasOutstandingFailure: candidate.hasOutstandingFailure,
    skipEnabled,
    headChecks: headEnabled,
    ...(deps.reconcileWithinMs === undefined
      ? {}
      : { reconcileWithinMs: deps.reconcileWithinMs }),
    now,
    interval: discoveryIntervalMs(candidate.activity, now, baseIntervalMs),
  })
  if (look.kind === 'skip') {
    await deps.discoveryRepo.markDiscoverySkipped(
      candidate.propertyId,
      now,
      look.nextDueAt,
    )
    state.skippedByTier[discoveryTierFor(candidate.activity, now)]++
    if (look.headCheck === true) await enqueueHeadCheck(deps, candidate, state, options)
    return true
  }
  state.fullByReason[look.reason]++
  return (await enqueueFullLook(deps, candidate, state, options)) === 'enqueued'
}

/**
 * Look at each candidate in turn, dating each property's next look as it
 * goes. Each property's next due time is priced on the backoff ladder from
 * its OWN activity evidence, so a burst-active property keeps the base
 * interval while a property quiet for days backs off.
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
  options: CandidateOptions,
): Promise<void> {
  for (const candidate of candidates) {
    if (!(await lookAtCandidate(deps, candidate, state, options))) return
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
    spreadWindowMs: number
    skipEnabled: boolean
    headEnabled: boolean
    logger: DiscoverHandlerDeps['logger']
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
    spreadWindowMs: options.spreadWindowMs,
    skipEnabled: options.skipEnabled,
    headEnabled: options.headEnabled,
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
    spreadWindowMs: number
    skipEnabled: boolean
    headEnabled: boolean
    logger: DiscoverHandlerDeps['logger']
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

const skippedTotal = (state: SweepState): number =>
  state.skippedByTier.hot + state.skippedByTier.warm + state.skippedByTier.cold

export const createDiscoverNewReviewsHandler = (deps: DiscoverHandlerDeps) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES
  const baseIntervalMs = deps.intervalMs ?? DEFAULT_DISCOVERY_INTERVAL_MS
  const spreadWindowMs = discoverySpreadWindowMs(baseIntervalMs, deps.spreadWindowMs)
  const skipEnabled = deps.skipRecentlyReconciled ?? false
  const headEnabled =
    (deps.headChecks === 'dark' || deps.headChecks === 'persist') &&
    deps.headCheckQueue !== undefined

  return async (_job: Job) => {
    return trace('job.discoverNewReviews', async () => {
      const logger = deps.logger
      const now = deps.clock()

      const state: SweepState = {
        cursor: null,
        batches: 0,
        seen: 0,
        enqueued: 0,
        enqueuedByTier: { hot: 0, warm: 0, cold: 0 },
        skippedByTier: { hot: 0, warm: 0, cold: 0 },
        fullByReason: {
          skip_disabled: 0,
          failure_retry: 0,
          no_reconciliation: 0,
          due: 0,
        },
        headChecksEnqueued: 0,
        headChecksFailed: 0,
        enqueueFailedPropertyId: null,
      }

      try {
        await runDiscoveryLoop(deps, state, {
          batchSize,
          maxBatches,
          now,
          baseIntervalMs,
          spreadWindowMs,
          skipEnabled,
          headEnabled,
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
            spreadWindowMs,
            // Ladder shape for this run: rising cold/warm counts are the
            // whole point — they are polls the flat interval used to spend.
            enqueuedHot: state.enqueuedByTier.hot,
            enqueuedWarm: state.enqueuedByTier.warm,
            enqueuedCold: state.enqueuedByTier.cold,
            // Looks that found a completed reconciliation inside the window
            // and enqueued nothing, by rung, then why every other look ran in
            // full. `skipped` + the four full counts = candidatesSeen unless
            // an enqueue failure ended the run.
            skipped: skippedTotal(state),
            skippedHot: state.skippedByTier.hot,
            skippedWarm: state.skippedByTier.warm,
            skippedCold: state.skippedByTier.cold,
            fullSkipDisabled: state.fullByReason.skip_disabled,
            fullFailureRetry: state.fullByReason.failure_retry,
            fullNoReconciliation: state.fullByReason.no_reconciliation,
            fullDue: state.fullByReason.due,
            // Head jobs the skipped looks handed to the queue (dark mode).
            headChecksEnqueued: state.headChecksEnqueued,
            headChecksFailed: state.headChecksFailed,
          },
          'Discover new reviews sweep finished',
        )
      }
    })
  }
}
