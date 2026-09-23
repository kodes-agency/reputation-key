// Feed notification surface — BullMQ job handler that repairs notification
// deliveries that never settled.
//
// A durable notification delivery is settled when its materialization receipt
// is claimed: a notification row was written, or preferences asked for none,
// or the recipient no longer qualifies. This job heals the one failure outbox
// redelivery cannot: a delivery Redis accepted that then never settled — its
// insert job exhausted its attempts, or Redis lost it — because the source
// fact's consumer has already recorded its receipt, so outbox redelivery skips
// it. A fact whose consumer never ran is not its business: dispatcher retries
// and published-event redelivery own it, and one that exhausts their bounded
// rounds has no enqueue receipt for this job to find, so it is replayed by
// hand, report first (runbook §15). After a grace period this job finds the
// unsettled deliveries, for every beta notification route, and replays their
// source fact through the route's own consumer:
//   - the fact keeps its real event id, so the delivery bridge stamps the same
//     delivery marker and settlement verifies the same durable source;
//   - the consumer re-derives its recipients, and the repair queue beneath the
//     bridge skips every delivery that already settled, so a recipient who
//     muted the type is never re-announced, and every delivery the original
//     fan-out never queued, so an identity derived only now (a moved anchor
//     Property, a recipient who joined since) never tells anyone twice;
//   - each repaired delivery is queued under an id derived from it, so a
//     retained original job cannot swallow it and a later firing converges on
//     the same job instead of queueing another — unless that repair job
//     itself spent its attempts, in which case the next firing queues it again.
// Each replay is authorized first, exactly as the dispatcher authorizes the
// consumer.
//
// Shape follows discover-new-reviews.job.ts: keyset-cursor batches ordered by
// (recorded_at, id, route) under a batch budget, so one firing never scans the
// table, and a fact whose replay fails does NOT hold the cursor — it stays
// unsettled, so the next firing sees it again. The firing still FAILS at the
// end, so a transient outage retries promptly and a persistent one is visible
// in queue metrics.
//
// Content-free: only counts, the route name and the fact's correlationId are
// logged (ADR 0030 / BQC-7.3).

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ConsumerRegistry } from '#/shared/outbox'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { gateDispatcherConsumer } from '#/shared/jobs/delayed-execution-gate'
import { GateDenyRetryError } from '#/shared/jobs/errors'
import { runWithContext } from '#/shared/observability/request-context'
import { trace } from '#/shared/observability/trace'
import type {
  NotificationDeliveryRepairRepositoryPort,
  UnsettledDeliveryCursor,
  UnsettledNotificationDelivery,
} from '../../application/ports/notification-delivery-repair.repository'

export const JOB_NAME = 'reconcile-missing-notifications' as const

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_MAX_BATCHES = 5

/**
 * How far back an unsettled delivery is still worth repairing. Wider than the
 * sweep's own cadence by two orders of magnitude, so a multi-hour worker
 * outage is fully repaired on the first firing after recovery; not unbounded,
 * because a notification about a day-old fact is no longer news. The
 * missing-notification gauge reads the same window.
 */
export const DEFAULT_RECONCILE_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * How fresh is too fresh to judge. An insert job Redis accepted a moment ago
 * is still inside its own retry budget; repairing it would only race it.
 */
export const DEFAULT_RECONCILE_GRACE_MS = 5 * 60 * 1000

/**
 * Saturation cap for the `notification.missing_for_inbox_item` gauge. Its
 * alert pages on any count above zero, so an exact count past this buys
 * nothing and would put an unbounded aggregate on the health path.
 */
export const NOTIFICATION_GAP_SCAN_LIMIT = 1000

export type ReconcileMissingNotificationsDeps = Readonly<{
  deliveries: NotificationDeliveryRepairRepositoryPort
  /** Every notification route, registered over the delivery-repair queue. */
  routes: ConsumerRegistry
  clock: () => Date
  logger: LoggerPort
  lookbackMs?: number
  graceMs?: number
  batchSize?: number
  maxBatches?: number
}>

type SweepState = {
  cursor: UnsettledDeliveryCursor | null
  batches: number
  seen: number
  replayed: number
  denied: number
  failed: number
}

/**
 * Replay one unsettled delivery's source fact through its route's consumer.
 * A failure is counted, never rethrown here — see the head-of-line note in
 * the file header.
 */
async function replayDelivery(
  deps: ReconcileMissingNotificationsDeps,
  candidate: UnsettledNotificationDelivery,
  state: SweepState,
): Promise<void> {
  const event = buildConsumerEvent(candidate.event)
  const correlationId = event.correlationId ?? undefined
  const consumerName = candidate.consumerName
  try {
    const route = deps.routes
      .listFor(event.eventType)
      .find((registration) => registration.consumerName === consumerName)
    if (!route) throw new Error(`no registered notification route ${consumerName}`)

    const gate = await gateDispatcherConsumer(consumerName, route.module, event)
    if (gate.kind === 'deny_terminal') {
      state.denied++
      return
    }
    if (gate.kind === 'deny_retry') {
      throw new GateDenyRetryError(consumerName, gate.decision.reason)
    }
    await runWithContext(event.eventId, () => route.handler(event), {
      causationId: event.eventId,
      ...(typeof event.commandId === 'string' ? { commandId: event.commandId } : {}),
    })
    state.replayed++
  } catch (err) {
    state.failed++
    deps.logger.warn(
      { err, correlationId, consumerName },
      'Failed to replay an unsettled notification delivery — it stays a candidate',
    )
  }
}

/** Fetch and replay one batch. Returns false when the window is exhausted. */
async function processBatch(
  deps: ReconcileMissingNotificationsDeps,
  state: SweepState,
  options: Readonly<{
    recordedAtOrAfter: Date
    enqueuedBefore: Date
    batchSize: number
  }>,
): Promise<boolean> {
  const batch = await deps.deliveries.findUnsettledDeliveries({
    recordedAtOrAfter: options.recordedAtOrAfter,
    enqueuedBefore: options.enqueuedBefore,
    cursor: state.cursor,
    limit: options.batchSize,
  })
  if (batch.length === 0) return false

  state.batches++
  state.seen += batch.length

  for (const candidate of batch) {
    await replayDelivery(deps, candidate, state)
  }

  const last = batch[batch.length - 1]!
  state.cursor = {
    recordedAt: last.event.recordedAt,
    eventId: last.event.id,
    consumerName: last.consumerName,
  }
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
      const now = deps.clock()
      const window = {
        recordedAtOrAfter: new Date(now.getTime() - lookbackMs),
        enqueuedBefore: new Date(now.getTime() - graceMs),
        batchSize,
      }
      const state: SweepState = {
        cursor: null,
        batches: 0,
        seen: 0,
        replayed: 0,
        denied: 0,
        failed: 0,
      }

      try {
        while (state.batches < maxBatches) {
          if (!(await processBatch(deps, state, window))) break
        }
      } finally {
        deps.logger.info(
          {
            deliveriesSeen: state.seen,
            factsReplayed: state.replayed,
            factsDenied: state.denied,
            factsFailed: state.failed,
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
          `reconcile-missing-notifications: ${state.failed} of ${state.seen} unsettled deliveries failed to replay`,
        )
      }
    })
  }
}
