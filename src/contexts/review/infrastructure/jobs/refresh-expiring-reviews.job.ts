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
import type { Review } from '../../domain/types'
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

type SweepState = {
  cursor: RefreshRunCursor | null
  batches: number
  seen: number
  dueCount: number
  enqueued: number
  enqueueFailed: number
  oldestDue: Date | null
}

type BatchOutcome =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'processed'; cursor: RefreshRunCursor }>
  | Readonly<{ kind: 'enqueue_failed' }>

/** Resolve the resume cursor from the previous run, when it stopped mid-sweep. */
function resolveResumeCursor(
  latest: {
    status: string
    cursorContentExpiresAt: Date | null
    cursorReviewId: string | null
  } | null,
): RefreshRunCursor | null {
  if (
    latest &&
    (latest.status === 'budget_exhausted' || latest.status === 'failed') &&
    latest.cursorContentExpiresAt &&
    latest.cursorReviewId
  ) {
    return {
      contentExpiresAt: latest.cursorContentExpiresAt,
      reviewId: latest.cursorReviewId,
    }
  }
  return null
}

/** Group due rows by (propertyId, connectionId, locationName, organizationId). */
function groupDueRowsBySyncKey(dueRows: ReadonlyArray<Review>): Map<string, SyncGroup> {
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
  return groups
}

/** Enqueue one sync job per group; failures are counted, not swallowed. */
async function enqueueSyncGroups(
  deps: RefreshHandlerDeps,
  groups: ReadonlyMap<string, SyncGroup>,
  state: SweepState,
  logger: ReturnType<typeof getLogger>,
): Promise<void> {
  for (const data of groups.values()) {
    try {
      await deps.queue.addSyncJob(data)
      state.enqueued++
    } catch (err) {
      state.enqueueFailed++
      logger.warn({ err, propertyId: data.propertyId }, 'Failed to enqueue refresh job')
    }
  }
}

/** Fetch, classify, group, and enqueue one batch. Never advances past failures. */
async function processSweepBatch(
  deps: RefreshHandlerDeps,
  state: SweepState,
  batchSize: number,
  threshold: Date,
  now: Date,
  logger: ReturnType<typeof getLogger>,
): Promise<BatchOutcome> {
  const batch = await deps.reviewRepo.findExpiringBatchAcrossTenants(
    threshold,
    state.cursor
      ? { contentExpiresAt: state.cursor.contentExpiresAt, id: state.cursor.reviewId }
      : null,
    batchSize,
  )
  if (batch.length === 0) return { kind: 'empty' }

  state.batches++
  state.seen += batch.length

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
  state.dueCount += dueRows.length
  for (const r of dueRows) {
    if (
      r.contentExpiresAt &&
      (!state.oldestDue || r.contentExpiresAt < state.oldestDue)
    ) {
      state.oldestDue = r.contentExpiresAt
    }
  }

  await enqueueSyncGroups(deps, groupDueRowsBySyncKey(dueRows), state, logger)
  if (state.enqueueFailed > 0) return { kind: 'enqueue_failed' }

  const last = batch[batch.length - 1]
  return {
    kind: 'processed',
    cursor: {
      contentExpiresAt: last.contentExpiresAt as Date,
      reviewId: last.id as string,
    },
  }
}

type PersistFn = (extra?: Record<string, unknown>) => Promise<void>

/** The bounded sweep loop — returns on empty/budget; throws on enqueue failure. */
async function runSweepLoop(
  deps: RefreshHandlerDeps,
  state: SweepState,
  options: Readonly<{
    batchSize: number
    maxBatches: number
    threshold: Date
    now: Date
    logger: ReturnType<typeof getLogger>
    persist: PersistFn
  }>,
): Promise<void> {
  for (;;) {
    if (state.batches >= options.maxBatches) return
    const outcome = await processSweepBatch(
      deps,
      state,
      options.batchSize,
      options.threshold,
      options.now,
      options.logger,
    )

    if (outcome.kind === 'empty') return

    if (outcome.kind === 'enqueue_failed') {
      // Never acknowledge a failed enqueue as success: hold the cursor
      // before this batch (reprocessed on retry; sync upserts are
      // idempotent), record 'failed', and throw for the queue retry.
      await options.persist({
        status: 'failed',
        failureReason: `${state.enqueueFailed} enqueue failure(s) in batch ${state.batches}`,
        finishedAt: deps.clock(),
        nextAttemptAt: deps.clock(),
      })
      throw new Error(
        `refresh sweep: ${state.enqueueFailed} enqueue failure(s) — run recorded failed, cursor held`,
      )
    }

    state.cursor = outcome.cursor
    await options.persist()
  }
}

/** Terminal state + oldest-due alert + completion log. */
async function finalizeSweep(
  deps: RefreshHandlerDeps,
  state: SweepState,
  options: Readonly<{
    exhausted: boolean
    resumed: boolean
    now: Date
    alertLeadMs: number
    logger: ReturnType<typeof getLogger>
    persist: PersistFn
  }>,
): Promise<void> {
  await options.persist({
    status: options.exhausted ? 'budget_exhausted' : 'completed',
    finishedAt: deps.clock(),
    nextAttemptAt: options.exhausted
      ? deps.clock()
      : new Date(deps.clock().getTime() + 60 * 60 * 1000),
  })

  if (
    state.oldestDue &&
    state.oldestDue.getTime() - options.now.getTime() < options.alertLeadMs
  ) {
    options.logger.warn(
      { oldestDueContentExpiresAt: state.oldestDue },
      'BQC-1.5: refresh-due content nearing the policy deadline',
    )
  }
  options.logger.info(
    {
      candidatesSeen: state.seen,
      refreshDueCount: state.dueCount,
      enqueued: state.enqueued,
      batchesProcessed: state.batches,
      resumed: options.resumed,
      status: options.exhausted ? 'budget_exhausted' : 'completed',
    },
    'Refresh expiring reviews completed',
  )
}

export const createRefreshExpiringReviewsHandler = (deps: RefreshHandlerDeps) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES
  const alertLeadMs = deps.alertLeadMs ?? DEFAULT_ALERT_LEAD_MS

  return async (_job: Job) => {
    return trace('job.refreshExpiringReviews', async () => {
      const logger = getLogger()
      const now = deps.clock()
      const threshold = contentRefreshDueThreshold(now)

      const resumeCursor = resolveResumeCursor(await deps.refreshRunRepo.findLatestRun())

      const run = await deps.refreshRunRepo.createRun({
        batchSize,
        maxBatches,
        cursor: resumeCursor,
      })

      const state: SweepState = {
        cursor: resumeCursor,
        batches: 0,
        seen: 0,
        dueCount: 0,
        enqueued: 0,
        enqueueFailed: 0,
        oldestDue: null,
      }

      const persist = (extra: Record<string, unknown> = {}) =>
        deps.refreshRunRepo.updateRun(run.id, {
          cursor: state.cursor,
          batchesProcessed: state.batches,
          candidatesSeen: state.seen,
          refreshDueCount: state.dueCount,
          enqueuedCount: state.enqueued,
          enqueueFailedCount: state.enqueueFailed,
          oldestDueContentExpiresAt: state.oldestDue,
          ...extra,
        })

      try {
        await runSweepLoop(deps, state, {
          batchSize,
          maxBatches,
          threshold,
          now,
          logger,
          persist,
        })

        await finalizeSweep(deps, state, {
          exhausted: state.batches >= maxBatches,
          resumed: resumeCursor !== null,
          now,
          alertLeadMs,
          logger,
          persist,
        })
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
