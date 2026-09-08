// Review context — recurring liveness owner for reply publication states.
//
// Every reachable non-terminal row carries reconcile_due_at. The sweep:
//   requested/authorized  → terminal retryable failure (no provider write began)
//   sending/pending       → one provider read, then ambiguous if not confirmed
//   ambiguous             → one final provider read, then terminal ambiguity
//
// This state-encoded two-read ceiling prevents accepted-but-not-echoed replies
// from generating unbounded Google reads. No outcome from this job authorizes a
// provider write; an exact observation may publish, and every other transition
// is a guarded command-store write.

import type { Job } from 'bullmq'
import { performance } from 'node:perf_hooks'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { ReconcileReplyPublication } from '../../application/use-cases/reconcile-reply-publication'
import type { Reply } from '../../domain/types'
import { reviewReplyPublishFailed } from '../../domain/events'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { PublicationReconciliationRunLease } from '../../application/ports/publication-reconciliation-run-lease.port'

export const JOB_NAME = 'reconcile-ambiguous-publications' as const

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_MAX_BATCHES = 10
const RECONCILIATION_MAX_RUN_MS = 240_000

type ReconcileSweepDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: Pick<ReviewRepository, 'findById'>
  replyCommandStore: Pick<
    ReplyCommandStore,
    'markPublicationAmbiguous' | 'markPublicationTerminal'
  >
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
  advanced: number
  terminal: number
  superseded: number
  failed: number
}

type Cursor = Readonly<{ reconcileDueAt: Date; id: string }>
type Logger = ReconcileSweepDeps['logger']
type RowOutcome = 'healed' | 'advanced' | 'terminal' | 'superseded' | 'failed'

async function publishFailedEvent(
  deps: ReconcileSweepDeps,
  reply: Reply,
  occurredAt: Date,
) {
  const review = await deps.reviewRepo.findById(reply.reviewId, reply.organizationId)
  if (!review) return null
  return reviewReplyPublishFailed({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: review.propertyId,
    organizationId: reply.organizationId,
    authorId: reply.createdBy,
    occurredAt,
  })
}

async function settleNonConfirmingRow(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
): Promise<Exclude<RowOutcome, 'healed'>> {
  const now = deps.clock()
  try {
    if (
      reply.publicationState === 'sending' ||
      reply.publicationState === 'pending_observation'
    ) {
      const event = await publishFailedEvent(deps, reply, now)
      const advanced = await deps.replyCommandStore.markPublicationAmbiguous(
        reply,
        event,
        now,
      )
      return advanced ? 'advanced' : 'superseded'
    }

    if (
      reply.publicationState === 'requested' ||
      reply.publicationState === 'authorized'
    ) {
      const event = await publishFailedEvent(deps, reply, now)
      const terminal = await deps.replyCommandStore.markPublicationTerminal(
        reply,
        'retryable',
        event,
        now,
      )
      return terminal ? 'terminal' : 'superseded'
    }

    if (reply.publicationState === 'ambiguous') {
      const terminal = await deps.replyCommandStore.markPublicationTerminal(
        reply,
        'ambiguous',
        null,
        now,
      )
      return terminal ? 'terminal' : 'superseded'
    }

    logger.warn('reconcile sweep: repository returned an ineligible row')
    return 'failed'
  } catch (err) {
    logger.warn({ err }, 'reconcile sweep: publication settlement failed')
    return 'failed'
  }
}

/** Reconcile one due row; failures are isolated to the row (never thrown). */
async function reconcileRow(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
): Promise<RowOutcome> {
  if (reply.publicationState === 'requested' || reply.publicationState === 'authorized') {
    return settleNonConfirmingRow(deps, reply, logger)
  }

  try {
    const result = await deps.reconcileReplyPublication({
      replyId: reply.id,
      organizationId: reply.organizationId,
    })
    if (result.isErr()) {
      logger.warn({ err: result.error }, 'reconcile sweep: provider read failed')
    } else if (result.value.outcome === 'confirmed_on_google') {
      return 'healed'
    }
  } catch (err) {
    logger.warn({ err }, 'reconcile sweep: provider read threw')
  }

  // A missing echo is not proof that an accepted Google reply is absent. The
  // first read exposes ambiguity; the second ends automatic reads without ever
  // granting permission for another PUT.
  return settleNonConfirmingRow(deps, reply, logger)
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
    else if (outcome === 'advanced') counts.advanced++
    else if (outcome === 'terminal') counts.terminal++
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
          advanced: 0,
          terminal: 0,
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
