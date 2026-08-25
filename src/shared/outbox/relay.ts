// Outbox relay — polls for unpublished events and publishes to BullMQ (PRE17A A3).
//
// The relay runs on a schedule, claims a batch of unpublished events using
// SKIP LOCKED, publishes each to the 'domain-events' BullMQ queue with the
// event UUID as the job ID (for deduplication), and marks them as published.
//
// BQC-3.7 hardening:
//   - Lease renewal: every LEASE_RENEW_EVERY published events the relay
//     renews the lease on the unprocessed remainder, so a slow batch cannot
//     lose its lease mid-publish (double-publish race; jobId dedup + receipts
//     were the only guard before).
//   - Host-scoped identity: relay-<hostname>-<pid> (pid-only is useless
//     across hosts/containers).
//   - Dispatch retry policy: enqueued jobs carry attempts + exponential
//     backoff so a first-failure dispatch retries, then quarantines via
//     BQC-3.6 (previously neither retried nor quarantined).
//   - NO payload pre-validation: the dispatcher is the single validation
//     authority (its 3.6 UnrecoverableError quarantines poison events).
//     Relay-side validation made a failing row un-enqueueable, so it was
//     re-claimed every poll forever — a poison busy loop.
//
// "Job already exists" is treated as accepted — the event was published
// but the markPublished call failed. The receipt in the consumer ensures
// idempotent processing regardless.

import { hostname } from 'node:os'
import type { Queue } from 'bullmq'
import {
  DEFAULT_LEASE_DURATION_MS,
  type OutboxRepository,
  type UnpublishedEvent,
} from './infrastructure/outbox-repository'
import { buildConsumerEvent } from './envelope'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'

export type OutboxRelay = Readonly<{
  /** Poll once: claim, publish, mark. Called on a schedule. */
  poll: () => Promise<void>
  /** Start polling on an interval. Returns a stop function. */
  start: (intervalMs: number) => () => void
}>

export type RelayConfig = Readonly<{
  /** Max events to claim per poll cycle. */
  batchSize: number
  /** How long to lease an event before another relay can reclaim it. */
  leaseDurationMs: number
  /** Identifier for this relay instance (for lease ownership). */
  relayId: string
  /** Optional lifecycle fence evaluated immediately before queue publication. */
  admitEvent?: (event: UnpublishedEvent) => Promise<boolean>
  /** REG-01: immutable process cell stamped onto every new queue envelope. */
  dataCellId?: DataCellId
}>

/** Renew the lease on the unprocessed remainder after this many publishes. */
const LEASE_RENEW_EVERY = 10

/**
 * Dispatch retry policy. Hand-set here because domain-events jobs are
 * EVENT-TYPED (named by eventType), not job-named, so the job-family catalogue
 * cannot resolve them.
 *
 * `attempts` is 8, not the catalogue default of 3, because the AI review
 * analysis consumer is the tightest budget on this queue and 3 could not reach
 * its terminal branch:
 *   - the domain terminal-settles a provider failure only on its 4th attempt
 *     (`aiRetryAt` returns null at attempt >= 4), which alone needs 4 dispatch
 *     attempts, and
 *   - quota/rate backpressure, an in-progress execution lease, language-runtime
 *     drift and a not-yet-written Property processing profile all retry BEFORE a
 *     provider attempt is claimed, so they consume dispatch attempts without
 *     consuming a domain attempt.
 * The domain therefore also bounds itself by a 15-minute (900s) operation
 * horizon and terminal-settles at it. With exponential 30s backoff and 0.5
 * jitter the minimum delay before attempt n+1 is 15s * 2^(n-1), so attempt 7
 * starts at least 15+30+60+120+240+480 = 945s after attempt 1 — strictly past
 * the horizon. 8 attempts leave one spare after the attempt that is guaranteed
 * to observe the horizon, so a `pending` outcome row can never be quarantined
 * and freeze a property's terminal analysis watermark.
 *
 * Raising the shared value only widens every other consumer's transient-failure
 * budget (~32 minutes before quarantine instead of ~1.5); BQC-3.6 quarantine and
 * the UnrecoverableError poison path are unchanged.
 */
export const DISPATCH_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000, jitter: 0.5 },
} as const

const DEFAULT_CONFIG: RelayConfig = {
  batchSize: 50,
  leaseDurationMs: DEFAULT_LEASE_DURATION_MS,
  relayId: `relay-${hostname()}-${process.pid}`,
}

export function createOutboxRelay(
  repo: OutboxRepository,
  queue: Queue | undefined,
  config: Partial<RelayConfig> = {},
): OutboxRelay {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const logger = getLogger()

  async function publishEvent(event: UnpublishedEvent): Promise<boolean> {
    if (!queue) {
      logger.warn(
        { eventType: event.eventType },
        'No domain-events queue — skipping publish',
      )
      return false
    }

    try {
      if (cfg.admitEvent && !(await cfg.admitEvent(event))) {
        logger.info(
          { eventType: event.eventType },
          'Outbox publication denied by lifecycle fence',
        )
        return false
      }
      // BQC-3.7: no payload validation here — the dispatcher validates (and
      // quarantines poison via 3.6 UnrecoverableError). The envelope carries
      // the stored payload plus envelope-grade metadata from the row.
      const envelope = buildConsumerEvent(event, cfg.dataCellId)

      // Use the event UUID as the BullMQ job ID for deduplication.
      // If the job already exists (re-publish after a crash), BullMQ
      // returns the existing job — treat as accepted.
      await queue.add(event.eventType, envelope, {
        jobId: event.id,
        ...DISPATCH_JOB_OPTIONS,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      })

      return true
    } catch (err) {
      // Redis failure — the lease expires and the row is reclaimed (jobId
      // dedup + receipts make the re-publish safe).
      logger.error(
        { err, eventType: event.eventType },
        'Failed to publish outbox event to BullMQ',
      )
      return false
    }
  }

  /** Renew the lease on the unprocessed remainder; failure is tolerated. */
  async function renewRemainingLease(
    remaining: readonly UnpublishedEvent[],
  ): Promise<void> {
    try {
      await repo.renewLease(
        remaining.map((e) => e.id),
        cfg.relayId,
        cfg.leaseDurationMs,
      )
    } catch (err) {
      // A failed renewal is not fatal: worst case the lease expires and the
      // rows are reclaimed (enqueue dedups on jobId, receipts dedup effects).
      logger.warn({ err, count: remaining.length }, 'Outbox lease renewal failed')
    }
  }

  const pollFn = async () => {
    await trace('outbox.relay.poll', async () => {
      const events = await repo.claimUnpublished(
        cfg.batchSize,
        cfg.relayId,
        cfg.leaseDurationMs,
      )

      if (events.length === 0) return

      logger.info({ count: events.length }, 'Relay claimed outbox events')

      for (let i = 0; i < events.length; i++) {
        if (i > 0 && i % LEASE_RENEW_EVERY === 0) {
          await renewRemainingLease(events.slice(i))
        }
        const published = await publishEvent(events[i]!)
        if (published) {
          await repo.markPublished(events[i]!.id)
        }
        // If publish failed, the lease will expire and another relay
        // (or this one on the next poll) will reclaim it.
      }
    })
  }

  return {
    poll: pollFn,

    start: (intervalMs: number) => {
      const timer = setInterval(() => {
        void pollFn().catch((err: unknown) => {
          logger.error({ err }, 'Outbox relay poll failed')
        })
      }, intervalMs)

      logger.info({ intervalMs, relayId: cfg.relayId }, 'Outbox relay started')

      return () => {
        clearInterval(timer)
        logger.info('Outbox relay stopped')
      }
    },
  }
}
