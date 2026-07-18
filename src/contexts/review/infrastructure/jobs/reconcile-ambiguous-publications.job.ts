// Review context — BullMQ job handler reconciling ambiguous reply publications (BQC-3.8)
//
// Keyset-bounded sweep mirroring refresh-expiring-reviews (500 rows/batch,
// 10 batches/run, keyset (reconcileDueAt, id) — no row skipped or repeated):
//
//   replies WHERE publication_state='ambiguous' AND reconcile_due_at <= now
//
// A row lands there when the publish job's FINAL attempt had an ambiguous
// outcome (the Google request may have landed — see classifyPublicationFailure
// and markPublicationAmbiguous, which sets reconcile_due_at = now + 15min).
// Every due row re-reads provider state via reconcileReplyPublication:
//   provider shows the reply → heal to published (atomic + published fact);
//   provider does not → stays publish_failed for an operator retry
//   (retryPublish runs the same reconcile before any new send).
//
// Per-row failure isolation: a failed row is counted, the batch finishes, and
// the run THROWS so BullMQ retries (mirroring retention-sweep — a failed row
// is never acknowledged as success). Reconcile is idempotent and only reads
// the provider; healed rows leave the ambiguous set, so a retried run
// converges instead of looping.

import type { Job } from 'bullmq'

export const JOB_NAME = 'reconcile-ambiguous-publications' as const
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReconcileReplyPublication } from '../../application/use-cases/reconcile-reply-publication'
import type { Reply } from '../../domain/types'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_MAX_BATCHES = 10

type ReconcileSweepDeps = Readonly<{
  replyRepo: ReplyRepository
  reconcileReplyPublication: ReconcileReplyPublication
  clock: () => Date
  batchSize?: number
  maxBatches?: number
}>

type SweepCounts = {
  batches: number
  seen: number
  healed: number
  stillFailed: number
  failed: number
}

type Cursor = Readonly<{ reconcileDueAt: Date; id: string }>

type Logger = ReturnType<typeof getLogger>

type RowOutcome = 'healed' | 'still_failed' | 'failed'

/** Reconcile one due row; failures are isolated to the row (never thrown). */
async function reconcileRow(
  deps: ReconcileSweepDeps,
  reply: Reply,
  logger: Logger,
): Promise<RowOutcome> {
  try {
    const result = await deps.reconcileReplyPublication({
      replyId: reply.id,
      organizationId: reply.organizationId,
    })
    if (result.isErr()) {
      logger.warn(
        { replyId: reply.id, err: result.error },
        'reconcile sweep: row reconcile failed',
      )
      return 'failed'
    }
    return result.value.outcome === 'published' ? 'healed' : 'still_failed'
  } catch (err) {
    logger.warn({ replyId: reply.id, err }, 'reconcile sweep: row threw')
    return 'failed'
  }
}

/** Reconcile every row of one batch into the run counts. */
async function processBatch(
  deps: ReconcileSweepDeps,
  batch: ReadonlyArray<Reply>,
  counts: SweepCounts,
  logger: Logger,
): Promise<void> {
  for (const reply of batch) {
    const outcome = await reconcileRow(deps, reply, logger)
    if (outcome === 'failed') counts.failed++
    else if (outcome === 'healed') counts.healed++
    else counts.stillFailed++
  }
}

export const createReconcileAmbiguousPublicationsHandler = (deps: ReconcileSweepDeps) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES

  return async (_job: Job) => {
    return trace('job.reconcileAmbiguousPublications', async () => {
      const logger = getLogger()
      const now = deps.clock()
      const counts: SweepCounts = {
        batches: 0,
        seen: 0,
        healed: 0,
        stillFailed: 0,
        failed: 0,
      }
      let cursor: Cursor | null = null

      for (;;) {
        if (counts.batches >= maxBatches) break
        const batch = await deps.replyRepo.findAmbiguousPublicationBatch(
          now,
          cursor,
          batchSize,
        )
        if (batch.length === 0) break
        counts.batches++
        counts.seen += batch.length

        await processBatch(deps, batch, counts, logger)

        const last = batch[batch.length - 1]
        // The batch query filters reconcile_due_at IS NOT NULL.
        cursor = { reconcileDueAt: last.reconcileDueAt as Date, id: last.id as string }
      }

      logger.info({ ...counts }, 'Reconcile ambiguous publications completed')

      if (counts.failed > 0) {
        // Mirror retention-sweep: never acknowledge a failed row as success —
        // throw for the BullMQ retry (reconcile is idempotent; healed rows
        // have left the ambiguous set).
        throw new Error(
          `reconcile-ambiguous-publications: ${counts.failed} row(s) failed across ${counts.batches} batch(es)`,
        )
      }
    })
  }
}
