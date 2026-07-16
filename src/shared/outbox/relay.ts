// Outbox relay — polls for unpublished events and publishes to BullMQ (PRE17A A3).
//
// The relay runs on a schedule, claims a batch of unpublished events using
// SKIP LOCKED, publishes each to the 'domain-events' BullMQ queue with the
// event UUID as the job ID (for deduplication), and marks them as published.
//
// "Job already exists" is treated as accepted — the event was published
// but the markPublished call failed. The receipt in the consumer ensures
// idempotent processing regardless.

import type { Queue } from 'bullmq'
import type {
  OutboxRepository,
  UnpublishedEvent,
} from './infrastructure/outbox-repository'
import { buildConsumerEvent } from './envelope'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

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
}>

const DEFAULT_CONFIG: RelayConfig = {
  batchSize: 50,
  leaseDurationMs: 30_000,
  relayId: `relay-${process.pid}`,
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
      logger.warn({ eventId: event.id }, 'No domain-events queue — skipping publish')
      return false
    }

    try {
      // Validate payload against the schema registry before publishing
      const validatedPayload = validateEventPayload(
        event.eventType,
        event.eventVersion,
        event.payload,
      )

      // BQR-2.1: enqueue the full ConsumerEvent envelope — not bare payload.
      // Dispatcher expects eventType/eventVersion/payload/metadata on job.data.
      const envelope = buildConsumerEvent(event, validatedPayload)

      // Use the event UUID as the BullMQ job ID for deduplication.
      // If the job already exists (re-publish after a crash), BullMQ
      // returns the existing job — treat as accepted.
      await queue.add(event.eventType, envelope, {
        jobId: event.id,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      })

      return true
    } catch (err) {
      logger.error(
        { err, eventId: event.id, eventType: event.eventType },
        'Failed to publish outbox event to BullMQ',
      )
      return false
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

      for (const event of events) {
        const published = await publishEvent(event)
        if (published) {
          await repo.markPublished(event.id)
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
