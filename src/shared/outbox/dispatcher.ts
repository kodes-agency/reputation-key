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
import type { ConsumerRegistration, ConsumerRegistry } from './consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { gateDispatcherConsumer } from '#/shared/jobs/delayed-execution-gate'
import { durableConsumersFor } from '#/shared/governance/event-job-catalogue'
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'

// ── Dispatcher ──────────────────────────────────────────────────────

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
  // BQC-7.3: correlationId is the only approved identifier correlation
  // field (ADR 0030); the event/job id itself is never logged.
  const correlationId = event.correlationId ?? undefined
  try {
    // Check receipt — skip if already processed
    const hasReceipt = await repo.hasReceipt(eventId, consumer.consumerName)
    if (hasReceipt) {
      logger.debug(
        { correlationId, consumerName: consumer.consumerName },
        'Consumer already has receipt — skipping',
      )
      return { kind: 'ok' }
    }

    // BQC-3.2: authorize against CURRENT policy before any protected
    // read or side effect. The consumer's OWN catalogue module decides the
    // policy action — a shared literal would authorize every context under
    // one context's row.
    const gate = await gateDispatcherConsumer(
      consumer.consumerName,
      consumer.module,
      event,
    )
    if (gate.kind === 'deny_terminal') {
      // BQC-3.6: record the terminal denial as an 'obsolete' receipt
      // ("processed without effect" — the receipts CHECK constraint admits
      // applied/duplicate/obsolete; no migration needed). Redelivery then
      // short-circuits on the receipt instead of re-evaluating forever.
      await repo.insertReceipt(eventId, consumer.consumerName, 'obsolete')
      logger.warn(
        {
          correlationId,
          consumerName: consumer.consumerName,
          reason: gate.decision.reason,
        },
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
      { correlationId, consumerName: consumer.consumerName, status: result.status },
      'Consumer completed',
    )
    return { kind: 'ok' }
  } catch (err) {
    if (err instanceof PolicyUnavailableError) throw err
    // Isolate the failure: other consumers still receive the event in this
    // attempt. The caller rethrows an aggregate so the BullMQ job fails and
    // configured attempts apply — receipts protect consumers that already
    // committed (they short-circuit on redelivery).
    // `err` alone serializes to `{ name }` here, which tells an operator nothing:
    // a schema rejection, a sequence gap and a provider retry all logged
    // identically. `failureReason` mirrors the quarantine envelope's rule —
    // error name plus the first message line, capped — and consumer failure
    // messages are code-only by contract.
    logger.error(
      {
        err,
        correlationId,
        consumerName: consumer.consumerName,
        failureReason: `${err instanceof Error ? err.name : 'unknown'}: ${
          err instanceof Error ? (err.message.split('\n')[0] ?? '') : ''
        }`.slice(0, 200),
      },
      'Consumer handler failed — job will fail after remaining consumers run',
    )
    return { kind: 'failed', consumerName: consumer.consumerName, err }
  }
}

/**
 * Create a dispatcher handler for the BullMQ 'domain-events' worker.
 * This function is passed to createJobWorker as the handler.
 */
export function createDispatcherHandler(
  repo: OutboxRepository,
  options: Readonly<{
    /**
     * ARC-03-T7: the container-owned consumer registry. Required — an ambient
     * default would let a dispatcher silently run against another container's
     * consumers, which is precisely the process-global coupling this replaced.
     */
    consumers: ConsumerRegistry
    localCell?: DataCellId
  }>,
) {
  const logger = getLogger()

  return async (job: Job) => {
    // Pre-existing marginal finding (cognitive 16); the 7.3 sweep only stripped banned log fields.
    // fallow-ignore-next-line complexity
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
        // picks it up). Reason is content-free: job name only (BQC-7.3 — no
        // job/event ids in logs or failure reasons).
        logger.error(
          { jobName },
          'Job data is not a ConsumerEvent envelope — unrecoverable (BQC-3.6)',
        )
        throw new UnrecoverableError(
          `outbox envelope malformed (job '${jobName}') — schema/envelope mismatch, no retry`,
        )
      }

      // Prefer envelope eventId; fall back to BullMQ job ID (relay sets jobId = event UUID)
      const eventId = event.eventId || jobId
      const eventType = event.eventType

      // REG-01 / ARC-02: newly relayed envelopes carry their source cell and,
      // for Property work, the freshly resolved target cell. A job injected
      // or delivered to another cell is terminally quarantined
      // before schema reads, receipts, or consumer effects. Missing is
      // accepted only for the documented pre-REG-01 in-flight shape.
      const targetCell = event.dataCellId ?? event.sourceCellId
      if (
        options.localCell &&
        targetCell !== undefined &&
        targetCell !== options.localCell
      ) {
        logger.error(
          {
            eventType,
            localCell: options.localCell,
            targetCell,
          },
          'Outbox envelope delivered to the wrong Data Cell — unrecoverable',
        )
        throw new UnrecoverableError(
          `outbox wrong_cell (${eventType}): target=${targetCell}, local=${options.localCell}`,
        )
      }

      // Validate payload against the schema registry
      try {
        validateEventPayload(event.eventType, event.eventVersion, event.payload)
      } catch (err) {
        // BQC-3.6: schema failures are unrecoverable. The reason carries the
        // type/version fingerprint only — never payload content or ids.
        logger.error(
          { err, eventType, correlationId: event.correlationId ?? undefined },
          'Event payload failed schema validation — unrecoverable (BQC-3.6)',
        )
        throw new UnrecoverableError(
          `event payload failed schema validation (${eventType}:v${event.eventVersion}) — no retry`,
        )
      }

      // Resolve consumers for this event type
      const consumers = options.consumers.listFor(eventType)

      if (consumers.length === 0) {
        // BQC-3.6: the catalogue decides whether this is a misconfigured
        // deployment (durable consumer expected but never registered → fail
        // so BullMQ retries; a redeploy fixes it) or a genuinely bus-only
        // family (no durable dispatch expected → complete).
        if (durableConsumersFor(eventType).length > 0) {
          logger.error(
            { eventType, correlationId: event.correlationId ?? undefined },
            'No consumers registered for catalogued durable event type — deployment/config failure',
          )
          throw new Error(
            `no durable consumer registered for catalogued event type '${eventType}' — deployment/config failure (BQC-3.6)`,
          )
        }
        logger.debug(
          { eventType, correlationId: event.correlationId ?? undefined },
          'No durable consumers for event type (bus-only family) — completing',
        )
        return
      }

      logger.info(
        {
          eventType,
          consumers: consumers.length,
          correlationId: event.correlationId ?? undefined,
        },
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
          `${failures.length} consumer(s) failed: ${failures
            .map((f) => f.consumerName)
            .join(', ')}`,
        )
      }
    })
  }
}
