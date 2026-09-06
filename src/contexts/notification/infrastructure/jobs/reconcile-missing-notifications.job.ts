// Notification context — BullMQ job handler that heals missing notifications.
//
// Consumer delivery is at-least-once via the outbox. This job is the backstop
// for a consumer that recorded a receipt without a notification: after a grace
// period it finds Inbox items with no notification row and re-enqueues their
// ordinary insert-notification jobs.
//
// Shape follows discover-new-reviews.job.ts:
//   - keyset-cursor batches ordered by (created_at, id), bounded batch budget,
//     so one firing can never scan the table;
//   - a candidate whose fan-out fails does NOT hold the cursor. It has zero
//     notifications by definition, so the next batch/firing sees it again;
//     stopping at it would let one poisoned item starve every later one. The
//     firing still FAILS at the end, so a transient outage retries promptly
//     and a persistent one is visible in queue metrics.
//
// Idempotency, deliberately without a second dedupe mechanism:
//   - the candidate query only returns items with ZERO notification rows, so a
//     healed item disappears from the next batch;
//   - the enqueued job is the ordinary insert-notification job, so the
//     notification insert path's own convergence (partial unique index on
//     (user_id, type, resource_id) WHERE status='unread' + onConflictDoUpdate)
//     is the backstop if two firings ever overlap;
//   - and because it IS that path, preferences are honoured: a user who turned
//     the email channel off is not backfilled mail, and a user with both
//     channels off gets nothing at all.
//
// Content-free: identifiers appear only inside `correlationId`; everything else
// logged is a count or an enum (ADR 0030 / BQC-7.3).

import type { Job } from 'bullmq'
import { createHash } from 'node:crypto'
import type { LoggerPort } from '#/shared/domain/logger.port'

export const JOB_NAME = 'reconcile-missing-notifications' as const

import type {
  MissingNotificationCandidate,
  MissingNotificationCursor,
  NotificationGapRepositoryPort,
} from '../../application/ports/notification-gap.repository'
import {
  fanoutInboxItemNotifications,
  type InboxFanoutDeps,
} from '../inbox-notification-fanout'
import { trace } from '#/shared/observability/trace'

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_MAX_BATCHES = 5

/**
 * How far back a gap is still worth healing. Wider than the sweep's own
 * cadence by two orders of magnitude, so a multi-hour worker outage is fully
 * repaired on the first firing after recovery; not unbounded, because a
 * notification about a day-old review is no longer news.
 */
export const DEFAULT_RECONCILE_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * How fresh is too fresh to judge. The happy path is event → BullMQ job →
 * insert, so an item created seconds ago legitimately has no notification yet.
 * Without this grace the sweep would race the normal path and coalesce a
 * second arrival onto every single new review.
 */
export const DEFAULT_RECONCILE_GRACE_MS = 5 * 60 * 1000

/**
 * Saturation cap for the `notification.missing_for_inbox_item` gauge. The
 * alert on it fires on "above zero, sustained", so an exact count past this
 * buys nothing and would put an unbounded aggregate on the health path.
 */
export const NOTIFICATION_GAP_SCAN_LIMIT = 1000

export type ReconcileMissingNotificationsDeps = InboxFanoutDeps &
  Readonly<{
    gapRepo: NotificationGapRepositoryPort
    lookbackMs?: number
    graceMs?: number
    batchSize?: number
    maxBatches?: number
  }>

type SweepState = {
  cursor: MissingNotificationCursor | null
  batches: number
  seen: number
  healed: number
  recipients: number
  skipped: number
  failed: number
}

/**
 * A stable UUID for a backfilled notification, derived from the Inbox item.
 *
 * Same item, same identity: the sweep is idempotent, and a receipt written by
 * one run is recognised by the next.
 */
function backfillEventId(inboxItemId: string): string {
  const digest = createHash('sha256')
    .update(`notification-reconcile/${inboxItemId}`)
    .digest('hex')
  const version = `5${digest.slice(13, 16)}`
  const variant = ((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0')
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    version,
    `${variant}${digest.slice(18, 20)}`,
    digest.slice(20, 32),
  ].join('-')
}

/**
 * Enqueue the notification jobs one candidate is missing. A failure is
 * counted, never rethrown here — see the head-of-line note in the file header.
 */
async function healCandidate(
  deps: ReconcileMissingNotificationsDeps,
  candidate: MissingNotificationCandidate,
  state: SweepState,
  logger: LoggerPort,
): Promise<void> {
  try {
    const outcome = await fanoutInboxItemNotifications(deps, {
      inboxItemId: candidate.inboxItemId,
      organizationId: candidate.organizationId,
      propertyId: candidate.propertyId,
      sourceType: candidate.sourceType,
      // A UUID, because this value does not stop at notifications.event_id
      // (varchar): it travels on as the outbox event identity, and
      // event_consumer_receipts.event_id is a uuid column. The literal
      // `reconcile:<id>` string therefore failed every insert with "invalid
      // input syntax for type uuid", so the sweep could never record a receipt
      // and healed nothing.
      //
      // Derived rather than random, so re-running the sweep for the same item
      // produces the same identity. The backfilled provenance the old prefix
      // carried lives on in correlationId below, which is not a uuid column.
      eventId: backfillEventId(candidate.inboxItemId),
      correlationId: `notification-reconcile:${candidate.inboxItemId}`,
    })
    if (outcome.kind === 'enqueued') {
      state.healed++
      state.recipients += outcome.recipients
      return
    }
    state.skipped++
  } catch (err) {
    state.failed++
    logger.warn(
      { err, correlationId: `notification-reconcile:${candidate.inboxItemId}` },
      'Failed to enqueue a backfilled notification — item stays a candidate',
    )
  }
}

/** Fetch and heal one batch. Returns false when the window is exhausted. */
async function processBatch(
  deps: ReconcileMissingNotificationsDeps,
  state: SweepState,
  options: Readonly<{
    createdAtOrAfter: Date
    createdBefore: Date
    batchSize: number
    logger: LoggerPort
  }>,
): Promise<boolean> {
  const batch = await deps.gapRepo.findItemsMissingNotifications({
    createdAtOrAfter: options.createdAtOrAfter,
    createdBefore: options.createdBefore,
    cursor: state.cursor,
    limit: options.batchSize,
  })
  if (batch.length === 0) return false

  state.batches++
  state.seen += batch.length

  for (const candidate of batch) {
    await healCandidate(deps, candidate, state, options.logger)
  }

  const last = batch[batch.length - 1]!
  state.cursor = { createdAt: last.createdAt, inboxItemId: last.inboxItemId }
  return true
}

export const createReconcileMissingNotificationsHandler = (
  deps: ReconcileMissingNotificationsDeps,
) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES
  const lookbackMs = deps.lookbackMs ?? DEFAULT_RECONCILE_LOOKBACK_MS
  const graceMs = deps.graceMs ?? DEFAULT_RECONCILE_GRACE_MS

  return async (_job: Job) => {
    return trace('job.reconcileMissingNotifications', async () => {
      const logger = deps.logger
      const now = deps.clock()
      const createdBefore = new Date(now.getTime() - graceMs)
      const createdAtOrAfter = new Date(now.getTime() - lookbackMs)

      const state: SweepState = {
        cursor: null,
        batches: 0,
        seen: 0,
        healed: 0,
        recipients: 0,
        skipped: 0,
        failed: 0,
      }

      try {
        while (state.batches < maxBatches) {
          const more = await processBatch(deps, state, {
            createdAtOrAfter,
            createdBefore,
            batchSize,
            logger,
          })
          if (!more) break
        }
      } finally {
        logger.info(
          {
            candidatesSeen: state.seen,
            itemsHealed: state.healed,
            notificationsEnqueued: state.recipients,
            itemsSkipped: state.skipped,
            itemsFailed: state.failed,
            batchesProcessed: state.batches,
            budgetExhausted: state.batches >= maxBatches,
            lookbackMs,
            graceMs,
          },
          'Reconcile missing notifications sweep finished',
        )
      }

      if (state.failed > 0) {
        throw new Error(
          `reconcile-missing-notifications: ${state.failed} of ${state.seen} candidates failed to enqueue`,
        )
      }
    })
  }
}
