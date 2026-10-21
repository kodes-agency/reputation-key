// Review context — BullMQ job handler for refreshing expiring reviews (BQC-1.5)
//
// Keyset-cursor bounded sweep, replacing the one-shot 5,000-row scan:
// - batches ordered (contentExpiresAt, id); cursor persists per batch so a
//   budget-exhausted or failed run resumes where it stopped;
// - a batch whose schedule update fails does NOT advance the cursor and the
//   run is recorded 'failed' + thrown — a failed update is never acknowledged
//   as success (the queue retry re-processes that batch; the update is
//   idempotent);
// - every run persists cursor, counts, oldest due expiry, failures, and
//   terminal state to review_refresh_runs (content-free);
// - purge safety: only successful fetches advance the clock (BQC-1.3), so a
//   failed refresh never masquerades as a successful observation.
//
// The sweep enqueues NO sync of its own (ADR 0055, note of 2026-10-21 (e)).
// Every completed snapshot already refreshes the 30-day content clock of every
// review it lists, so a Property whose reviews are about to expire needs a
// snapshot, not a special one. The sweep moves the Property's next discovery
// look up to now when its last completed reconciliation is over a day old; the
// discovery sweep then runs it with its start spread, its skip rule and its
// failure backoff. A Property reconciled inside the day is left alone: that
// listing already refreshed every review Google lists, so a review that still
// expires was not listed, and letting it expire is correct. The run row keeps
// its column names: `enqueued_count` counts Properties pulled forward and
// `enqueue_failed_count` counts failed schedule updates.
//
// BQR-3.2 / ADR 0031: fetch-based contentExpiresAt + SourceContentPolicy.

import type { Job } from 'bullmq'

export const JOB_NAME = 'refresh-expiring-reviews' as const
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReviewDiscoveryRepository } from '../../application/ports/review-discovery.repository'
import type { Review } from '../../domain/types'
import type {
  ReviewRefreshRunRepository,
  RefreshRunCursor,
} from '../../application/ports/review-refresh-run.repository'
import {
  classifyReviewsForRefresh,
  contentRefreshDueThreshold,
} from '../../application/source-content-lifecycle'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_MAX_BATCHES = 10
/**
 * A completed reconciliation newer than this already refreshed every review
 * Google lists for the Property, so its still-expiring reviews are not listed.
 */
const RECONCILED_WITHIN_MS = 24 * 60 * 60 * 1000
/** Warn when the oldest refresh-due content is this close to hard expiry. */
const DEFAULT_ALERT_LEAD_MS = 2 * 24 * 60 * 60 * 1000

type RefreshHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  discoveryRepo: Pick<ReviewDiscoveryRepository, 'pullLooksForward'>
  refreshRunRepo: ReviewRefreshRunRepository
  clock: () => Date
  logger: Pick<LoggerPort, 'info' | 'warn'>
  batchSize?: number
  maxBatches?: number
  alertLeadMs?: number
}>

type SweepState = {
  cursor: RefreshRunCursor | null
  batches: number
  seen: number
  dueCount: number
  /** Properties whose next discovery look moved up to now. */
  pulledForward: number
  /** Properties left alone: a completed reconciliation inside the day covers them. */
  skippedRecent: number
  /** Properties left alone: a failure is waiting for its backoff retry date. */
  skippedBackoff: number
  pullFailed: number
  /** Properties already handled by an earlier batch of this run. */
  handled: Set<string>
  oldestDue: Date | null
}

type BatchOutcome =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'processed'; cursor: RefreshRunCursor }>
  | Readonly<{ kind: 'pull_failed' }>

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

/** The Properties of the due rows, in first-seen order, minus those already handled. */
function newPropertyIds(
  dueRows: ReadonlyArray<Review>,
  handled: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>()
  for (const review of dueRows) {
    const propertyId = review.propertyId as string
    if (!handled.has(propertyId)) ids.add(propertyId)
  }
  return [...ids]
}

/** Move the look of each Property up; a failure is counted, not swallowed. */
async function pullPropertiesForward(
  deps: RefreshHandlerDeps,
  propertyIds: readonly string[],
  state: SweepState,
  now: Date,
  logger: RefreshHandlerDeps['logger'],
): Promise<void> {
  if (propertyIds.length === 0) return
  try {
    const result = await deps.discoveryRepo.pullLooksForward(
      propertyIds,
      now,
      new Date(now.getTime() - RECONCILED_WITHIN_MS),
    )
    state.pulledForward += result.pulledForward
    state.skippedRecent += result.skippedRecent
    state.skippedBackoff += result.skippedBackoff
    for (const id of propertyIds) state.handled.add(id)
  } catch (err) {
    state.pullFailed++
    logger.warn({ err }, 'Failed to pull a discovery look forward for refresh')
  }
}

/** Fetch, classify, and pull forward one batch. Never advances past failures. */
async function processSweepBatch(
  deps: RefreshHandlerDeps,
  state: SweepState,
  batchSize: number,
  threshold: Date,
  now: Date,
  logger: RefreshHandlerDeps['logger'],
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

  await pullPropertiesForward(
    deps,
    newPropertyIds(dueRows, state.handled),
    state,
    now,
    logger,
  )
  if (state.pullFailed > 0) return { kind: 'pull_failed' }

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

/** The bounded sweep loop — returns on empty/budget; throws on a failed schedule update. */
async function runSweepLoop(
  deps: RefreshHandlerDeps,
  state: SweepState,
  options: Readonly<{
    batchSize: number
    maxBatches: number
    threshold: Date
    now: Date
    logger: RefreshHandlerDeps['logger']
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

    if (outcome.kind === 'pull_failed') {
      // Never acknowledge a failed update as success: hold the cursor before
      // this batch (reprocessed on retry; the update is idempotent), record
      // 'failed', and throw for the queue retry.
      await options.persist({
        status: 'failed',
        failureReason: `${state.pullFailed} pull-forward failure(s) in batch ${state.batches}`,
        finishedAt: deps.clock(),
        nextAttemptAt: deps.clock(),
      })
      throw new Error(
        `refresh sweep: ${state.pullFailed} pull-forward failure(s) — run recorded failed, cursor held`,
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
    logger: RefreshHandlerDeps['logger']
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
      pulledForward: state.pulledForward,
      skippedRecent: state.skippedRecent,
      skippedBackoff: state.skippedBackoff,
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
      const logger = deps.logger
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
        pulledForward: 0,
        skippedRecent: 0,
        skippedBackoff: 0,
        pullFailed: 0,
        handled: new Set<string>(),
        oldestDue: null,
      }

      const persist = (extra: Record<string, unknown> = {}) =>
        deps.refreshRunRepo.updateRun(run.id, {
          cursor: state.cursor,
          batchesProcessed: state.batches,
          candidatesSeen: state.seen,
          refreshDueCount: state.dueCount,
          enqueuedCount: state.pulledForward,
          enqueueFailedCount: state.pullFailed,
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
        // The failed-update path already persisted 'failed'; other throws
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
