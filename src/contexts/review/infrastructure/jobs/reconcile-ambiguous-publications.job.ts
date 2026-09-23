// Review context — recurring liveness owner for reply publication states.
//
// Every reachable non-terminal row carries reconcile_due_at. The sweep:
//   requested/authorized → terminal retryable failure (no provider write began)
//   sending              → D4 evidence, then one provider read; an absent,
//                          unreadable or failed read inside the 15-minute
//                          propagation grace stays sending, due in one minute
//                          (read again on this job's next five-minute run);
//                          otherwise ambiguous at the next ladder rung
//   pending              → bounded absent- or unreadable-echo grace, then
//                          ambiguous at the next ladder rung
//   ambiguous            → D4 evidence, then one provider read per ladder rung
//                          (15 min … 72 h from the attempt start); any
//                          non-confirming read, including a failed or
//                          unreadable one, reschedules, and only an exhausted
//                          ladder (or a missing attempt start) makes it
//                          terminal ambiguity
//   approved + ambiguous → restore-fenced; terminal ambiguity at once, with no
//                          evidence and no read (see isRestoreFencedAmbiguity)
//
// Evidence comes first: positive proof that no request for the attempt reached
// Google settles it as not published (safe to retry by a manager). Absence on
// a read never does. The pending grace has independent age/read ceilings. No
// outcome from this job authorizes a provider write; an exact observation may
// publish, and every other transition is a guarded command-store write.

import type { Job } from 'bullmq'
import { performance } from 'node:perf_hooks'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { ReplyPublicationDispatchEvidencePort } from '../../application/ports/reply-publication-dispatch-evidence.port'
import { attemptNeverDispatched } from './attempt-never-dispatched'
import type {
  ReconcilePublicationOutcome,
  ReconcileReplyPublication,
} from '../../application/use-cases/reconcile-reply-publication'
import type { Reply } from '../../domain/types'
import {
  reviewReplyPublishFailed,
  type ReplyPublishFailureOutcome,
} from '../../domain/events'
import {
  canDeferPendingProviderObservation,
  canDeferUncertainSend,
  canDeferUnreadablePendingObservation,
  nextAmbiguousReconcileDueAt,
  UNCERTAIN_SEND_RECHECK_DELAY_MS,
} from '../../domain/reply-publication-workflow'
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
    | 'deferPendingPublicationObservation'
    | 'deferUncertainSend'
    | 'markPublicationAmbiguous'
    | 'markPublicationTerminal'
    | 'rescheduleAmbiguousReconciliation'
    | 'settleNeverDispatchedAttempt'
  >
  /** D4: the only input that may settle an uncertain attempt as never sent. */
  dispatchEvidence: ReplyPublicationDispatchEvidencePort
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
  advanced: number
  terminal: number
  settled: number
  superseded: number
  failed: number
}

type Cursor = Readonly<{ reconcileDueAt: Date; id: string }>
type Logger = ReconcileSweepDeps['logger']
type RowOutcome =
  'healed' | 'deferred' | 'advanced' | 'terminal' | 'settled' | 'superseded' | 'failed'
/** A provider read result, or null when the read failed or threw. */
type ProviderOutcome = ReconcilePublicationOutcome['outcome'] | null

async function publishFailedEvent(
  deps: ReconcileSweepDeps,
  reply: Reply,
  occurredAt: Date,
  outcome: ReplyPublishFailureOutcome,
) {
  const review = await deps.reviewRepo.findById(reply.reviewId, reply.organizationId)
  if (!review) return null
  return reviewReplyPublishFailed({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: review.propertyId,
    organizationId: reply.organizationId,
    authorId: reply.createdBy,
    outcome,
    occurredAt,
  })
}

/** Whether an accepted write may keep waiting for Google to echo it. An absent
 * read is bounded by attempt age and the absent-read cap; an unreadable one
 * records no observation, so only the age bounds it. Anything else ends it. */
function pendingEchoMayStillArrive(
  progress: Readonly<{ attemptStartedAt: Date; absentObservationCount: number }>,
  providerOutcome: ProviderOutcome,
  now: Date,
): boolean {
  if (providerOutcome === 'absent') {
    return canDeferPendingProviderObservation({ ...progress, now })
  }
  if (providerOutcome === 'unreadable') {
    return canDeferUnreadablePendingObservation({
      attemptStartedAt: progress.attemptStartedAt,
      now,
    })
  }
  return false
}

/** `pending_observation`: bounded propagation grace, then ambiguity on the ladder. */
async function settlePendingObservation(
  deps: ReconcileSweepDeps,
  reply: Reply,
  providerOutcome: ProviderOutcome,
): Promise<'deferred' | 'advanced' | 'superseded'> {
  const now = deps.clock()
  const progress = await deps.replyRepo.findPublicationAttemptObservationProgress({
    organizationId: reply.organizationId,
    reviewId: reply.reviewId,
    replyId: reply.id,
    publicationCycle: reply.publicationCycle,
    attemptNumber: reply.publicationAttempts,
  })
  if (progress && pendingEchoMayStillArrive(progress, providerOutcome, now)) {
    const deferred = await deps.replyCommandStore.deferPendingPublicationObservation(
      reply,
      now,
    )
    return deferred ? 'deferred' : 'superseded'
  }
  // Google acknowledged the write; only its echo is missing.
  const event = await publishFailedEvent(deps, reply, now, 'unconfirmed')
  // D3: ambiguity starts at the ladder rung after the attempt's age.
  const dueAt = progress
    ? (nextAmbiguousReconcileDueAt({
        attemptStartedAt: progress.attemptStartedAt,
        now,
      }) ?? undefined)
    : undefined
  const advanced = await deps.replyCommandStore.markPublicationAmbiguous(
    reply,
    event,
    now,
    dueAt,
  )
  return advanced ? 'advanced' : 'superseded'
}

async function settleNonConfirmingRow(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
  providerOutcome: ProviderOutcome,
): Promise<Exclude<RowOutcome, 'healed'>> {
  const now = deps.clock()
  try {
    if (reply.publicationState === 'pending_observation') {
      return await settlePendingObservation(deps, reply, providerOutcome)
    }

    if (
      reply.publicationState === 'requested' ||
      reply.publicationState === 'authorized'
    ) {
      // Never claimed for sending, so nothing reached Google.
      const event = await publishFailedEvent(deps, reply, now, 'not_sent')
      const terminal = await deps.replyCommandStore.markPublicationTerminal(
        reply,
        'retryable',
        event,
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

/** One targeted provider read. A failed or thrown read is null, never final. */
async function readProvider(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
): Promise<ProviderOutcome> {
  try {
    const result = await deps.reconcileReplyPublication({
      replyId: reply.id,
      organizationId: reply.organizationId,
    })
    if (result.isErr()) {
      logger.warn({ err: result.error }, 'reconcile sweep: provider read failed')
      return null
    }
    if (result.value.outcome === 'unreadable') {
      logger.info(
        { reason: result.value.reason ?? null },
        'reconcile sweep: Google shows a reply RepKey cannot match to this attempt',
      )
    }
    return result.value.outcome
  } catch (err) {
    logger.warn({ err }, 'reconcile sweep: provider read threw')
    return null
  }
}

async function settleNeverDispatched(
  deps: ReconcileSweepDeps,
  reply: Reply,
): Promise<RowOutcome> {
  const now = deps.clock()
  // An ambiguous row already recorded its publish_failed fact; the store would
  // drop a second one, so do not look the Review up for it.
  const event =
    reply.status === 'publish_failed'
      ? null
      : await publishFailedEvent(deps, reply, now, 'not_sent')
  const settled = await deps.replyCommandStore.settleNeverDispatchedAttempt(
    reply,
    event,
    now,
  )
  return settled ? 'settled' : 'superseded'
}

/** A read that neither confirmed nor ruled out the attempt. A missing review
 * is lifecycle evidence, not propagation, so it does not wait out the grace. */
function isInconclusiveRead(outcome: ProviderOutcome): boolean {
  return outcome === null || outcome === 'absent' || outcome === 'unreadable'
}

/** D3 `sending`: wait inside the grace, otherwise ambiguous on the ladder. */
async function waitOrMarkAmbiguous(
  deps: ReconcileSweepDeps,
  reply: Reply,
  providerOutcome: ProviderOutcome,
  attemptStartedAt: Date | null,
): Promise<RowOutcome> {
  const now = deps.clock()
  if (
    attemptStartedAt &&
    isInconclusiveRead(providerOutcome) &&
    canDeferUncertainSend({ attemptStartedAt, now })
  ) {
    const deferred = await deps.replyCommandStore.deferUncertainSend(
      reply,
      new Date(now.getTime() + UNCERTAIN_SEND_RECHECK_DELAY_MS),
      now,
    )
    return deferred ? 'deferred' : 'superseded'
  }
  const event = await publishFailedEvent(deps, reply, now, 'unconfirmed')
  const dueAt = attemptStartedAt
    ? (nextAmbiguousReconcileDueAt({ attemptStartedAt, now }) ?? undefined)
    : undefined
  const advanced = await deps.replyCommandStore.markPublicationAmbiguous(
    reply,
    event,
    now,
    dueAt,
  )
  return advanced ? 'advanced' : 'superseded'
}

/** D3 `ambiguous`: the next ladder rung, or terminal once the ladder ends. */
async function rescheduleOrEndLadder(
  deps: ReconcileSweepDeps,
  reply: Reply,
  attemptStartedAt: Date | null,
): Promise<RowOutcome> {
  const now = deps.clock()
  const dueAt = attemptStartedAt
    ? nextAmbiguousReconcileDueAt({ attemptStartedAt, now })
    : null
  if (dueAt) {
    const rescheduled = await deps.replyCommandStore.rescheduleAmbiguousReconciliation(
      reply,
      dueAt,
      now,
    )
    return rescheduled ? 'deferred' : 'superseded'
  }
  // No attempt start (pre-RPL legacy evidence) dates no ladder: fail closed to
  // the pre-ladder ending rather than checking forever.
  const terminal = await deps.replyCommandStore.markPublicationTerminal(
    reply,
    'ambiguous',
    null,
    now,
  )
  return terminal ? 'terminal' : 'superseded'
}

/** `sending` and `ambiguous`: evidence first, then one read, then the ladder. */
async function reconcileUncertainRow(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
): Promise<RowOutcome> {
  try {
    const attemptStartedAt = await deps.replyRepo.findCurrentPublicationAttemptStartedAt({
      organizationId: reply.organizationId,
      reviewId: reply.reviewId,
      replyId: reply.id,
      publicationCycle: reply.publicationCycle,
      attemptNumber: reply.publicationAttempts,
    })
    if (!attemptStartedAt) {
      logger.warn(
        { publicationState: reply.publicationState },
        'reconcile sweep: publication attempt start is missing',
      )
    } else if (
      await attemptNeverDispatched(deps, reply, attemptStartedAt, (err) => {
        // Treated as "possibly dispatched": the row takes the read path instead.
        logger.warn(
          { errorName: err instanceof Error ? err.name : null },
          'reconcile sweep: dispatch evidence unavailable',
        )
      })
    ) {
      return await settleNeverDispatched(deps, reply)
    }

    const providerOutcome = await readProvider(deps, reply, logger)
    if (providerOutcome === 'confirmed_on_google') return 'healed'
    return reply.publicationState === 'sending'
      ? await waitOrMarkAmbiguous(deps, reply, providerOutcome, attemptStartedAt)
      : await rescheduleOrEndLadder(deps, reply, attemptStartedAt)
  } catch (err) {
    logger.warn({ err }, 'reconcile sweep: publication settlement failed')
    return 'failed'
  }
}

/**
 * A restore-fenced row: postgres-recovery-fence.ts moves every restored
 * `sending` row to `ambiguous` and leaves its status `approved`. Its permit may
 * have been written after the restore point and lost, so permit absence proves
 * nothing, and the store accordingly refuses to settle or reschedule it and
 * reconciliation refuses to read it. It ends as terminal ambiguity on its first
 * due run, as every ambiguous row did before the ladder; "Check Google again"
 * still works from there, and dispatch evidence keeps refusing to prove it
 * never sent because the attempt predates the recovery run
 * (reply-publication-dispatch-evidence.ts).
 */
function isRestoreFencedAmbiguity(reply: Reply): boolean {
  return reply.status !== 'publish_failed' && reply.publicationState === 'ambiguous'
}

async function endRestoreFencedAmbiguity(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
): Promise<RowOutcome> {
  try {
    const now = deps.clock()
    // The fence recorded no failure fact, and the row now fails for the manager.
    const event = await publishFailedEvent(deps, reply, now, 'unconfirmed')
    const terminal = await deps.replyCommandStore.markPublicationTerminal(
      reply,
      'ambiguous',
      event,
      now,
    )
    return terminal ? 'terminal' : 'superseded'
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
    return settleNonConfirmingRow(deps, reply, logger, null)
  }
  if (isRestoreFencedAmbiguity(reply)) {
    return endRestoreFencedAmbiguity(deps, reply, logger)
  }
  if (reply.publicationState === 'sending' || reply.publicationState === 'ambiguous') {
    return reconcileUncertainRow(deps, reply, logger)
  }

  // An absent echo after provider acceptance is ordinary propagation while
  // both grace bounds hold. Once either bound closes, this is exactly the
  // pre-existing ambiguity path.
  const providerOutcome = await readProvider(deps, reply, logger)
  if (providerOutcome === 'confirmed_on_google') return 'healed'
  return settleNonConfirmingRow(deps, reply, logger, providerOutcome)
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
    else if (outcome === 'advanced') counts.advanced++
    else if (outcome === 'terminal') counts.terminal++
    else if (outcome === 'settled') counts.settled++
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
          deferred: 0,
          advanced: 0,
          terminal: 0,
          settled: 0,
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
