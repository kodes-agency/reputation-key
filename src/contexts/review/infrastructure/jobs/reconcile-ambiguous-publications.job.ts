// Review context — BullMQ job handler reconciling provider-pending and
// ambiguous reply publications.
//
// Keyset-bounded sweep mirroring refresh-expiring-reviews (500 rows/batch,
// 10 batches/run, keyset (reconcileDueAt, id)). A monotonic 240s internal
// deadline leaves 60s before the non-cancelling 300s worker timeout for one
// already-started bounded provider read, its guarded checkpoint, reporting,
// and advisory-lease release.
//
//   replies WHERE publication_state IN ('pending_observation', 'ambiguous')
//           AND reconcile_due_at <= now
//
// A row lands there when the publish job's FINAL attempt had an ambiguous
// outcome (the Google request may have landed — see classifyPublicationFailure
// and markPublicationAmbiguous, which sets reconcile_due_at = now + 15min).
// Every due row re-reads provider state via reconcileReplyPublication. An
// exact observation heals the Reply to published. Every other result advances
// that exact row's schedule beyond this run's frozen clock, guarded by its
// state, cycle, and old due time. Old absent/error rows therefore cannot keep
// occupying the first bounded page and starving later due work.
//
// Per-row failure isolation: a failed row is counted, the batch finishes, and
// the run THROWS so BullMQ retries. The failed row has already been deferred,
// so the retry can continue with other due work instead of looping on it.

import type { Job } from 'bullmq'

export const JOB_NAME = 'reconcile-ambiguous-publications' as const
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReconcileReplyPublication } from '../../application/use-cases/reconcile-reply-publication'
import type { Reply } from '../../domain/types'
import {
  AMBIGUOUS_RECONCILE_DELAY_MS,
  PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
} from '../../domain/reply-publication-workflow'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { performance } from 'node:perf_hooks'
import type { PublicationReconciliationRunLease } from '../../application/ports/publication-reconciliation-run-lease.port'

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_MAX_BATCHES = 10
const RECONCILIATION_MAX_RUN_MS = 240_000

type ReconcileSweepDeps = Readonly<{
  replyRepo: ReplyRepository
  reconcileReplyPublication: ReconcileReplyPublication
  clock: () => Date
  logger: Pick<LoggerPort, 'info' | 'warn'>
  /** Cross-process lease; a busy result makes this firing a clean no-op. */
  runLease: PublicationReconciliationRunLease
  /** Monotonic clock for deadline accounting; wall-clock changes are irrelevant. */
  monotonicNowMs?: () => number
  maxRunMs?: number
  batchSize?: number
  maxBatches?: number
}>

type SweepCounts = {
  batches: number
  seen: number
  healed: number
  deferred: number
  superseded: number
  failed: number
}

type Cursor = Readonly<{ reconcileDueAt: Date; id: string }>

type Logger = ReconcileSweepDeps['logger']

type RowOutcome = 'healed' | 'deferred' | 'superseded' | 'failed'

async function deferRow(
  deps: ReconcileSweepDeps,
  reply: Reply,
  now: Date,
  logger: Logger,
): Promise<'deferred' | 'superseded' | 'failed'> {
  if (
    reply.reconcileDueAt === null ||
    (reply.publicationState !== 'pending_observation' &&
      reply.publicationState !== 'ambiguous')
  ) {
    logger.warn('reconcile sweep: repository returned an ineligible row')
    return 'failed'
  }

  const delay =
    reply.publicationState === 'pending_observation'
      ? PROVIDER_OBSERVATION_RECONCILE_DELAY_MS
      : AMBIGUOUS_RECONCILE_DELAY_MS
  try {
    const deferred = await deps.replyRepo.deferPublicationReconciliation({
      replyId: reply.id,
      organizationId: reply.organizationId,
      publicationCycle: reply.publicationCycle,
      publicationState: reply.publicationState,
      currentDueAt: reply.reconcileDueAt,
      nextDueAt: new Date(now.getTime() + delay),
      updatedAt: now,
    })
    return deferred ? 'deferred' : 'superseded'
  } catch (err) {
    logger.warn({ err }, 'reconcile sweep: row deferral failed')
    return 'failed'
  }
}

/** Reconcile one due row; failures are isolated to the row (never thrown). */
async function reconcileRow(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
): Promise<RowOutcome> {
  let reconciliationFailed = false
  try {
    const result = await deps.reconcileReplyPublication({
      replyId: reply.id,
      organizationId: reply.organizationId,
    })
    if (result.isErr()) {
      logger.warn({ err: result.error }, 'reconcile sweep: row reconcile failed')
      reconciliationFailed = true
    } else if (result.value.outcome === 'confirmed_on_google') {
      return 'healed'
    }
  } catch (err) {
    logger.warn({ err }, 'reconcile sweep: row threw')
    reconciliationFailed = true
  }

  // Base the next due time on completion of this row's provider read, not the
  // sweep start. A long bounded run must not make an early short deferral due
  // again before the run (or its BullMQ retry) has finished.
  const deferred = await deferRow(deps, reply, deps.clock(), logger)
  if (deferred !== 'deferred') return deferred
  return reconciliationFailed ? 'failed' : 'deferred'
}

/** Reconcile rows until the batch ends or the internal start deadline closes. */
async function processBatch(
  deps: ReconcileSweepDeps,
  batch: ReadonlyArray<Reply>,
  counts: SweepCounts,
  logger: Logger,
  deadlineReached: () => boolean,
): Promise<Readonly<{ lastProcessed: Reply | null; stoppedForDeadline: boolean }>> {
  let lastProcessed: Reply | null = null
  for (const reply of batch) {
    if (deadlineReached()) {
      return { lastProcessed, stoppedForDeadline: true }
    }
    counts.seen++
    const outcome = await reconcileRow(deps, reply, logger)
    if (outcome === 'failed') counts.failed++
    else if (outcome === 'healed') counts.healed++
    else if (outcome === 'deferred') counts.deferred++
    else counts.superseded++
    lastProcessed = reply
  }
  return { lastProcessed, stoppedForDeadline: false }
}

export const createReconcileAmbiguousPublicationsHandler = (deps: ReconcileSweepDeps) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES
  const maxRunMs = deps.maxRunMs ?? RECONCILIATION_MAX_RUN_MS
  const monotonicNowMs = deps.monotonicNowMs ?? (() => performance.now())
  if (!Number.isSafeInteger(maxRunMs) || maxRunMs <= 0) {
    throw new Error('reconcile-ambiguous-publications maxRunMs must be positive')
  }

  return async (_job: Job) => {
    // Pool checkout/advisory-lock acquisition is part of the non-cancelling
    // worker budget. Starting this clock afterward would overstate the 60s
    // operational reserve whenever PostgreSQL connection retries are slow.
    const runDeadline = monotonicNowMs() + maxRunMs
    const reachedDeadline = () => monotonicNowMs() >= runDeadline
    const lease = await deps.runLease.tryAcquire()
    if (!lease) {
      deps.logger.info(
        'Reconcile provider publication observations skipped: another run is active',
      )
      return
    }
    try {
      if (reachedDeadline()) {
        deps.logger.info(
          'Reconcile provider publication observations skipped: run deadline closed during lease acquisition',
        )
        return
      }
      return await trace('job.reconcileAmbiguousPublications', async () => {
        const logger = deps.logger
        const now = deps.clock()
        const counts: SweepCounts = {
          batches: 0,
          seen: 0,
          healed: 0,
          deferred: 0,
          superseded: 0,
          failed: 0,
        }
        let cursor: Cursor | null = null
        let stoppedForDeadline = false

        for (;;) {
          const deadlineClosed = reachedDeadline()
          if (counts.batches >= maxBatches || deadlineClosed) {
            stoppedForDeadline = deadlineClosed
            break
          }
          const batch = await deps.replyRepo.findDuePublicationReconciliationBatch(
            now,
            cursor,
            batchSize,
          )
          if (batch.length === 0) break
          counts.batches++

          const processed = await processBatch(
            deps,
            batch,
            counts,
            logger,
            reachedDeadline,
          )
          stoppedForDeadline = processed.stoppedForDeadline

          if (processed.lastProcessed) {
            // The batch query filters reconcile_due_at IS NOT NULL. Advance only
            // through work actually checkpointed; an unstarted suffix remains
            // due for the next non-overlapping firing.
            cursor = {
              reconcileDueAt: processed.lastProcessed.reconcileDueAt as Date,
              id: processed.lastProcessed.id as string,
            }
          }
          if (stoppedForDeadline) break
        }

        logger.info(
          { ...counts, stoppedForDeadline },
          'Reconcile provider publication observations completed',
        )

        if (counts.failed > 0) {
          // Mirror retention-sweep: never acknowledge a failed row as success —
          // throw for the BullMQ retry (reconcile is idempotent; healed rows
          // have left the ambiguous set).
          throw new Error(
            `reconcile-ambiguous-publications: ${counts.failed} row(s) failed across ${counts.batches} batch(es)`,
          )
        }
      })
    } finally {
      await lease.release()
    }
  }
}
