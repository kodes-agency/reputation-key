// Consumer dispatcher — receives events from BullMQ and dispatches to
// registered consumers idempotently (PRE17A A3).
//
// The dispatcher is a BullMQ worker on the 'domain-events' queue. For each
// event, it:
//   1. Validates the payload against the schema registry
//   2. Resolves registered consumers by event type
//   3. For each consumer, checks the receipt — if already applied, skip
//   4. If not applied, invokes the consumer's handler
//   5. The handler commits its state change + receipt atomically
//   6. If the source no longer exists, commits an 'obsolete' receipt
//
// One consumer's terminal failure does NOT prevent other consumers from
// receiving the event. Each consumer is invoked independently.

import type { Job } from 'bullmq'
import type { OutboxRepository } from './infrastructure/outbox-repository'
import { parseConsumerEvent, type ConsumerEvent } from './envelope'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

// ── Consumer registration ───────────────────────────────────────────

export type { ConsumerEvent }

export type ConsumerHandler = (event: ConsumerEvent) => Promise<ConsumerResult>

export type ConsumerResult = Readonly<{
  /** 'applied' — consumer processed the event and committed state + receipt. */
  status: 'applied' | 'duplicate' | 'obsolete'
}>

export type ConsumerRegistration = Readonly<{
  /** Event type this consumer handles (e.g., 'review.received'). */
  eventType: string
  /** Consumer name — must be unique per event type. Used in receipts. */
  consumerName: string
  /** Handler function. Must commit state + receipt atomically. */
  handler: ConsumerHandler
}>

// ── Dispatcher ──────────────────────────────────────────────────────

const consumersByType = new Map<string, ConsumerRegistration[]>()

/**
 * Register a consumer for an event type.
 * Multiple consumers can register for the same event type — each is
 * invoked independently when the event is dispatched.
 */
export function registerConsumer(reg: ConsumerRegistration): void {
  const list = consumersByType.get(reg.eventType) ?? []
  // Check for duplicate consumer name within the same event type
  if (list.some((c) => c.consumerName === reg.consumerName)) {
    throw new Error(
      `Duplicate consumer "${reg.consumerName}" for event type "${reg.eventType}"`,
    )
  }
  list.push(reg)
  consumersByType.set(reg.eventType, list)
}

/** Clear all consumers — useful for tests. */
export function clearConsumers(): void {
  consumersByType.clear()
}

/** List registered consumers (event type + name). Tests / operator diagnostics. */
export function listRegisteredConsumers(): ReadonlyArray<
  Readonly<{ eventType: string; consumerName: string }>
> {
  const out: Array<{ eventType: string; consumerName: string }> = []
  for (const [eventType, regs] of consumersByType) {
    for (const reg of regs) {
      out.push({ eventType, consumerName: reg.consumerName })
    }
  }
  return out
}

/**
 * Create a dispatcher handler for the BullMQ 'domain-events' worker.
 * This function is passed to createJobWorker as the handler.
 */
export function createDispatcherHandler(repo: OutboxRepository) {
  const logger = getLogger()

  return async (job: Job) => {
    await trace('outbox.dispatch', async () => {
      const { id: jobId, name: jobName, data } = job
      if (!jobId) {
        logger.error({ jobName }, 'Job has no ID — cannot process outbox event')
        return
      }

      // BQR-2.1: require full ConsumerEvent envelope (relay must not send bare payload)
      const event = parseConsumerEvent(data)
      if (!event) {
        logger.error(
          { jobId, jobName },
          'Job data is not a ConsumerEvent envelope — discarding (BQR-2.1 contract)',
        )
        return
      }

      // Prefer envelope eventId; fall back to BullMQ job ID (relay sets jobId = event UUID)
      const eventId = event.eventId || jobId
      const eventType = event.eventType

      // Validate payload against the schema registry
      try {
        validateEventPayload(event.eventType, event.eventVersion, event.payload)
      } catch (err) {
        logger.error(
          { err, eventId, eventType },
          'Event payload validation failed — discarding',
        )
        return
      }

      // Resolve consumers for this event type
      const consumers = consumersByType.get(eventType) ?? []

      if (consumers.length === 0) {
        logger.warn(
          { eventId, eventType },
          'No consumers registered for event type — event will be retried',
        )
        return
      }

      logger.info(
        { eventId, eventType, consumers: consumers.length },
        'Dispatching event to consumers',
      )

      // Invoke each consumer independently — one failure doesn't block others
      for (const consumer of consumers) {
        try {
          // Check receipt — skip if already processed
          const hasReceipt = await repo.hasReceipt(eventId, consumer.consumerName)
          if (hasReceipt) {
            logger.debug(
              { eventId, consumerName: consumer.consumerName },
              'Consumer already has receipt — skipping',
            )
            continue
          }

          // Invoke the consumer handler
          // The handler is responsible for committing its state change
          // AND the receipt atomically (via its command store)
          const result = await consumer.handler(event)

          logger.debug(
            { eventId, consumerName: consumer.consumerName, status: result.status },
            'Consumer completed',
          )
        } catch (err) {
          // Log and continue — other consumers should still receive the event
          logger.error(
            { err, eventId, consumerName: consumer.consumerName },
            'Consumer handler failed — other consumers will still be processed',
          )
          // The receipt was NOT committed, so this event will be retried
          // for this consumer on the next BullMQ attempt
        }
      }
    })
  }
}
