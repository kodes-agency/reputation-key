// Review context — BullMQ job handler for refreshing expiring reviews (BQC-1.5)
//
// Keyset-cursor bounded sweep, replacing the one-shot 5,000-row scan:
// - batches ordered (contentExpiresAt, id); cursor persists per batch so a
//   budget-exhausted or failed run resumes where it stopped;
// - a batch with an enqueue failure does NOT advance the cursor and the run
//   is recorded 'failed' + thrown — a failed enqueue is never acknowledged
//   as success (the queue retry re-processes that batch; sync upserts are
//   idempotent);
// - every run persists cursor, counts, oldest due expiry, failures, and
//   terminal state to review_refresh_runs (content-free);
// - purge safety: only successful fetches advance the clock (BQC-1.3), so a
//   failed refresh never masquerades as a successful observation.
//
// BQR-3.2 / ADR 0031: fetch-based contentExpiresAt + SourceContentPolicy.

import type { Job } from 'bullmq'

export const JOB_NAME = 'refresh-expiring-reviews' as const
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import type {
  ReviewRefreshRunRepository,
  RefreshRunCursor,
} from '../../application/ports/review-refresh-run.repository'
import {
  classifyReviewsForRefresh,
  contentRefreshDueThreshold,
} from '../../application/source-content-lifecycle'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_MAX_BATCHES = 10
/** Warn when the oldest refresh-due content is this close to hard expiry. */
const DEFAULT_ALERT_LEAD_MS = 2 * 24 * 60 * 60 * 1000

type RefreshHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  queue: ReviewQueuePort
  refreshRunRepo: ReviewRefreshRunRepository
  clock: () => Date
  batchSize?: number
  maxBatches?: number
  alertLeadMs?: number
}>

type SyncGroup = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
}>

export const createRefreshExpiringReviewsHandler = (deps: RefreshHandlerDeps) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES
  const alertLeadMs = deps.alertLeadMs ?? DEFAULT_ALERT_LEAD_MS

  return async (_job: Job) => {
    return trace('job.refreshExpiringReviews', async () => {
      const logger = getLogger()
      const now = deps.clock()
      const threshold = contentRefreshDueThreshold(now)

      // Resume from the previous run's cursor when it stopped mid-sweep
      // (budget exhausted or failed with an unadvanced cursor).
      const latest = await deps.refreshRunRepo.findLatestRun()
      const resumeCursor: RefreshRunCursor | null =
        latest &&
        (latest.status === 'budget_exhausted' || latest.status === 'failed') &&
        latest.cursorContentExpiresAt &&
        latest.cursorReviewId
          ? {
              contentExpiresAt: latest.cursorContentExpiresAt,
              reviewId: latest.cursorReviewId,
            }
          : null

      const run = await deps.refreshRunRepo.createRun({
        batchSize,
        maxBatches,
        cursor: resumeCursor,
      })

      let cursor: RefreshRunCursor | null = resumeCursor
      let batches = 0
      let seen = 0
      let dueCount = 0
      let enqueued = 0
      let enqueueFailed = 0
      let oldestDue: Date | null = null
      let stop: 'empty' | 'budget'

      const persist = (extra: Record<string, unknown> = {}) =>
        deps.refreshRunRepo.updateRun(run.id, {
          cursor,
          batchesProcessed: batches,
          candidatesSeen: seen,
          refreshDueCount: dueCount,
          enqueuedCount: enqueued,
          enqueueFailedCount: enqueueFailed,
          oldestDueContentExpiresAt: oldestDue,
          ...extra,
        })

      try {
        for (;;) {
          if (batches >= maxBatches) {
            stop = 'budget'
            break
          }
          const batch = await deps.reviewRepo.findExpiringBatchAcrossTenants(
            threshold,
            cursor
              ? { contentExpiresAt: cursor.contentExpiresAt, id: cursor.reviewId }
              : null,
            batchSize,
          )
          if (batch.length === 0) {
            stop = 'empty'
            break
          }
          batches++
          seen += batch.length

          // Classify with the same pure rules as unit tests: only refresh_due
          // (already-expired rows are the purge job's responsibility).
          const { refreshDue } = classifyReviewsForRefresh(
            batch.map((r) => ({
              id: r.id as string,
              lastFetchedAt: r.lastFetchedAt,
              contentExpiresAt: r.contentExpiresAt,
            })),
            now,
          )
          const dueIds = new Set(refreshDue)
          const dueRows = batch.filter((r) => dueIds.has(r.id as string))
          dueCount += dueRows.length
          for (const r of dueRows) {
            if (r.contentExpiresAt && (!oldestDue || r.contentExpiresAt < oldestDue)) {
              oldestDue = r.contentExpiresAt
            }
          }

          // Group by (propertyId, connectionId, locationName, organizationId)
          const groups = new Map<string, SyncGroup>()
          for (const review of dueRows) {
            const connectionId = review.googleConnectionId
            if (!connectionId) continue
            const key = `${review.propertyId}:${connectionId}:${review.externalLocationId}`
            if (!groups.has(key)) {
              groups.set(key, {
                propertyId: review.propertyId as string,
                organizationId: review.organizationId as string,
                connectionId: connectionId as string,
                locationName: review.externalLocationId,
              })
            }
          }

          let batchHadEnqueueFailure = false
          for (const data of groups.values()) {
            try {
              await deps.queue.addSyncJob(data)
              enqueued++
            } catch (err) {
              enqueueFailed++
              batchHadEnqueueFailure = true
              logger.warn(
                { err, propertyId: data.propertyId },
                'Failed to enqueue refresh job',
              )
            }
          }

          if (batchHadEnqueueFailure) {
            // Never acknowledge a failed enqueue as success: hold the cursor
            // before this batch (reprocessed on retry; sync upserts are
            // idempotent), record 'failed', and throw for the queue retry.
            await persist({
              status: 'failed',
              failureReason: `${enqueueFailed} enqueue failure(s) in batch ${batches}`,
              finishedAt: deps.clock(),
              nextAttemptAt: deps.clock(),
            })
            throw new Error(
              `refresh sweep: ${enqueueFailed} enqueue failure(s) — run recorded failed, cursor held`,
            )
          }

          // Advance past the fully-enqueued batch.
          const last = batch[batch.length - 1]
          cursor = {
            contentExpiresAt: last.contentExpiresAt as Date,
            reviewId: last.id as string,
          }
          await persist()
        }

        if (stop === 'empty') {
          await persist({
            status: 'completed',
            finishedAt: deps.clock(),
            nextAttemptAt: new Date(deps.clock().getTime() + 60 * 60 * 1000),
          })
        } else {
          await persist({
            status: 'budget_exhausted',
            finishedAt: deps.clock(),
            nextAttemptAt: deps.clock(),
          })
        }

        if (oldestDue && oldestDue.getTime() - now.getTime() < alertLeadMs) {
          logger.warn(
            { oldestDueContentExpiresAt: oldestDue },
            'BQC-1.5: refresh-due content nearing the policy deadline',
          )
        }
        logger.info(
          {
            candidatesSeen: seen,
            refreshDueCount: dueCount,
            enqueued,
            batchesProcessed: batches,
            resumed: resumeCursor !== null,
            status: stop === 'empty' ? 'completed' : 'budget_exhausted',
          },
          'Refresh expiring reviews completed',
        )
      } catch (err) {
        // The enqueue-failure path already persisted 'failed'; other throws
        // record a failure once, best-effort, then rethrow for queue retry.
        const alreadyRecorded =
          err instanceof Error && err.message.startsWith('refresh sweep:')
        if (!alreadyRecorded) {
          await persist({
            status: 'failed',
            failureReason: err instanceof Error ? err.message : String(err),
            finishedAt: deps.clock(),
            nextAttemptAt: deps.clock(),
          }).catch(() => {})
        }
        throw err
      }
    })
  }
}
