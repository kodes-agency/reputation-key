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
// One consumer's failure does NOT prevent other consumers from receiving the
// event in this attempt — every consumer is invoked. BQC-3.6: after the loop
// the job FAILS if any consumer threw, so configured BullMQ attempts apply;
// receipts protect already-applied consumers on redelivery (they short-circuit).
//
// BQC-3.6 outcome mapping (phase BQC-3 §4 failure taxonomy):
//   malformed envelope / schema failure → UnrecoverableError (no retry — the
//     job lands in BullMQ failed state immediately, content-free reason)
//   zero consumers for a type the catalogue marks durably consumed → throw
//     (deployment/config failure — BullMQ retries; a redeploy fixes it)
//   zero consumers for a bus-only type → complete (debug log)
//   terminal policy deny → 'obsolete' receipt (processed without effect) so
//     the denial is not re-evaluated forever

import type { Job } from 'bullmq'
import { UnrecoverableError } from 'bullmq'
import type { OutboxRepository } from './infrastructure/outbox-repository'
import { parseConsumerEvent, type ConsumerEvent } from './envelope'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { gateDispatcherConsumer } from '#/shared/jobs/delayed-execution-gate'
import { durableConsumersFor } from '#/shared/governance/event-job-catalogue'

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
 * BQC-3.2: thrown when the delayed execution policy is unavailable so the
 * error escapes the per-consumer catch and BullMQ retries the whole job.
 */
class PolicyUnavailableError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'PolicyUnavailableError'
  }
}

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

/** Per-consumer outcome — the loop aggregates failures after invoking all. */
type ConsumerOutcome =
  | Readonly<{ kind: 'ok' }>
  | Readonly<{ kind: 'failed'; consumerName: string; err: unknown }>

/**
 * Invoke one consumer for an event: receipt short-circuit, BQC-3.2 policy
 * gate, then the handler. A handler failure is reported (never swallowed) so
 * the caller can fail the job after every consumer has been invoked.
 */
async function invokeConsumer(
  deps: Readonly<{
    repo: OutboxRepository
    logger: ReturnType<typeof getLogger>
    eventId: string
    event: ConsumerEvent
    consumer: ConsumerRegistration
  }>,
): Promise<ConsumerOutcome> {
  const { repo, logger, eventId, event, consumer } = deps
  try {
    // Check receipt — skip if already processed
    const hasReceipt = await repo.hasReceipt(eventId, consumer.consumerName)
    if (hasReceipt) {
      logger.debug(
        { eventId, consumerName: consumer.consumerName },
        'Consumer already has receipt — skipping',
      )
      return { kind: 'ok' }
    }

    // BQC-3.2: authorize against CURRENT policy before any protected
    // read or side effect.
    const gate = await gateDispatcherConsumer(
      consumer.consumerName,
      'inbox.outbox-consumers',
      event,
    )
    if (gate.kind === 'deny_terminal') {
      // BQC-3.6: record the terminal denial as an 'obsolete' receipt
      // ("processed without effect" — the receipts CHECK constraint admits
      // applied/duplicate/obsolete; no migration needed). Redelivery then
      // short-circuits on the receipt instead of re-evaluating forever.
      await repo.insertReceipt(eventId, consumer.consumerName, 'obsolete')
      logger.warn(
        { eventId, consumerName: consumer.consumerName, reason: gate.decision.reason },
        'delayed execution denied — terminal (consumer skipped, obsolete receipt written)',
      )
      return { kind: 'ok' }
    }
    if (gate.kind === 'deny_retry') {
      // Policy unavailable is transient, not a revocation — escape the
      // per-consumer catch so the BullMQ job fails and retries.
      throw new PolicyUnavailableError(gate.decision.reason)
    }

    // Invoke the consumer handler
    // The handler is responsible for committing its state change
    // AND the receipt atomically (via its command store)
    const result = await consumer.handler(event)

    logger.debug(
      { eventId, consumerName: consumer.consumerName, status: result.status },
      'Consumer completed',
    )
    return { kind: 'ok' }
  } catch (err) {
    if (err instanceof PolicyUnavailableError) throw err
    // Isolate the failure: other consumers still receive the event in this
    // attempt. The caller rethrows an aggregate so the BullMQ job fails and
    // configured attempts apply — receipts protect consumers that already
    // committed (they short-circuit on redelivery).
    logger.error(
      { err, eventId, consumerName: consumer.consumerName },
      'Consumer handler failed — job will fail after remaining consumers run',
    )
    return { kind: 'failed', consumerName: consumer.consumerName, err }
  }
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
        // BQC-3.6: no retry — content-free reason (job name only).
        logger.error({ jobName }, 'Job has no ID — unrecoverable')
        throw new UnrecoverableError(
          `outbox job '${jobName}' has no id — unrecoverable (BQC-3.6)`,
        )
      }

      // BQR-2.1: require full ConsumerEvent envelope (relay must not send bare payload)
      const event = parseConsumerEvent(data)
      if (!event) {
        // BQC-3.6: malformed envelopes are unrecoverable — the job lands in
        // BullMQ failed state immediately (quarantine substrate; 3.7 alerting
        // picks it up). Reason is content-free: job name + id only.
        logger.error(
          { jobId, jobName },
          'Job data is not a ConsumerEvent envelope — unrecoverable (BQC-3.6)',
        )
        throw new UnrecoverableError(
          `outbox envelope malformed (job '${jobName}', id ${jobId}) — schema/envelope mismatch, no retry`,
        )
      }

      // Prefer envelope eventId; fall back to BullMQ job ID (relay sets jobId = event UUID)
      const eventId = event.eventId || jobId
      const eventType = event.eventType

      // Validate payload against the schema registry
      try {
        validateEventPayload(event.eventType, event.eventVersion, event.payload)
      } catch (err) {
        // BQC-3.6: schema failures are unrecoverable. The reason carries the
        // type/version fingerprint only — never payload content.
        logger.error(
          { err, eventId, eventType },
          'Event payload failed schema validation — unrecoverable (BQC-3.6)',
        )
        throw new UnrecoverableError(
          `event payload failed schema validation (${eventType}:v${event.eventVersion}, id ${eventId}) — no retry`,
        )
      }

      // Resolve consumers for this event type
      const consumers = consumersByType.get(eventType) ?? []

      if (consumers.length === 0) {
        // BQC-3.6: the catalogue decides whether this is a misconfigured
        // deployment (durable consumer expected but never registered → fail
        // so BullMQ retries; a redeploy fixes it) or a genuinely bus-only
        // family (no durable dispatch expected → complete).
        if (durableConsumersFor(eventType).length > 0) {
          logger.error(
            { eventId, eventType },
            'No consumers registered for catalogued durable event type — deployment/config failure',
          )
          throw new Error(
            `no durable consumer registered for catalogued event type '${eventType}' — deployment/config failure (BQC-3.6)`,
          )
        }
        logger.debug(
          { eventId, eventType },
          'No durable consumers for event type (bus-only family) — completing',
        )
        return
      }

      logger.info(
        { eventId, eventType, consumers: consumers.length },
        'Dispatching event to consumers',
      )

      // Invoke each consumer independently — one failure doesn't block the
      // others in this attempt — then fail the job if any consumer threw so
      // configured attempts apply (BQC-3.6).
      const failures: Array<{ consumerName: string; err: unknown }> = []
      for (const consumer of consumers) {
        const outcome = await invokeConsumer({ repo, logger, eventId, event, consumer })
        if (outcome.kind === 'failed') {
          failures.push({ consumerName: outcome.consumerName, err: outcome.err })
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((f) => f.err),
          `${failures.length} consumer(s) failed for event ${eventId}: ${failures
            .map((f) => f.consumerName)
            .join(', ')}`,
        )
      }
    })
  }
}
