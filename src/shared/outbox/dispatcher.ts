// The dispatcher resolves work IDs to stored facts, then applies each consumer
// idempotently. Consumer receipts, rather than queue success, settle delivery.
//
// The dispatcher is a BullMQ worker on the 'domain-events' queue. For each
// event, it:
//   1. Validates the payload against the schema registry
//   2. Resolves registered consumers by event type
//   3. For each consumer, checks the receipt — if already applied, skip
//   4. If not applied, invokes the consumer's handler
//   5. The handler records its own receipt: in the transaction of its state
//      change, or after an effect that is safe to repeat (the rule is stated
//      on ConsumerRegistration.handler)
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
//   zero consumers for a type the catalogue marks consumed → throw
//     (deployment/config failure — BullMQ retries; a redeploy fixes it)
//   zero consumers for an audit-only type → complete (debug log)
//   terminal policy deny → 'obsolete' receipt (processed without effect) so
//     the denial is not re-evaluated forever

import type { Job } from 'bullmq'
import { UnrecoverableError } from 'bullmq'
import { PrerequisiteNotReadyError } from './prerequisite-not-ready'
import type { OutboxRepository } from './infrastructure/outbox-repository'
import { buildConsumerEvent, type ConsumerEvent } from './envelope'
import {
  OUTBOX_DELIVERY_KIND,
  OUTBOX_DELIVERY_LEASE_MS,
  escalateStalePrerequisiteWait,
} from './dispatch-job-options'
import type { ConsumerRegistration, ConsumerRegistry } from './consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import {
  gateDispatcherConsumer,
  withConsumerScope,
} from '#/shared/jobs/delayed-execution-gate'
import { durableConsumersFor } from '#/shared/governance/event-job-catalogue'
import { runWithContext } from '#/shared/observability/request-context'

// ── Dispatcher ──────────────────────────────────────────────────────

/** Per-consumer outcome — the loop aggregates failures after invoking all. */
type ConsumerOutcome =
  | Readonly<{ kind: 'ok' }>
  | Readonly<{ kind: 'waiting'; consumerName: string }>
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
    const decision = await gateDispatcherConsumer(
      consumer.consumerName,
      consumer.module,
      event,
    )
    if (!decision.allowed) {
      // BQC-3.6: record the terminal denial as an 'obsolete' receipt
      // ("processed without effect" — the receipts CHECK constraint admits
      // applied/duplicate/obsolete; no migration needed). Redelivery then
      // short-circuits on the receipt instead of re-evaluating forever.
      await repo.insertReceipt(eventId, consumer.consumerName, 'obsolete')
      logger.warn(
        {
          correlationId,
          consumerName: consumer.consumerName,
          reason: decision.reason,
        },
        'delayed execution denied — terminal (consumer skipped, obsolete receipt written)',
      )
      return { kind: 'ok' }
    }

    // Invoke the consumer handler. The handler records its own receipt, with
    // its state change or after an effect that is safe to repeat; nothing
    // below records one for it (ConsumerRegistration.handler states the rule).
    const result = await withConsumerScope(
      consumer.consumerName,
      consumer.module,
      event,
      () =>
        runWithContext(eventId, () => consumer.handler(event), {
          causationId: event.eventId,
          ...(typeof event.commandId === 'string' ? { commandId: event.commandId } : {}),
        }),
    )

    logger.debug(
      { correlationId, consumerName: consumer.consumerName, status: result.status },
      'Consumer completed',
    )
    return { kind: 'ok' }
  } catch (err) {
    if (err instanceof PrerequisiteNotReadyError) {
      // An expected ordering wait: the job still retries, but it is not an error.
      logger.info(
        { correlationId, consumerName: consumer.consumerName, reason: err.code },
        'Consumer prerequisite not ready — retrying shortly',
      )
      return { kind: 'waiting', consumerName: consumer.consumerName }
    }
    // Isolate the failure: other consumers still receive the event in this
    // attempt. The caller rethrows an aggregate so the BullMQ job fails and
    // configured attempts apply — receipts protect consumers that already
    // committed (they short-circuit on redelivery).
    // `err` alone serializes to `{ name }` here, which tells an operator nothing:
    // a schema rejection, an ordering rejection and a provider retry all logged
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
 * Deliver one built event to its registered consumers. The work-ledger handler
 * below calls this with the event it just built from the stored fact.
 */
export function createEventDispatcher(
  repo: OutboxRepository,
  options: Readonly<{
    /**
     * ARC-03-T7: the container-owned consumer registry. Required — an ambient
     * default would let a dispatcher silently run against another container's
     * consumers, which is precisely the process-global coupling this replaced.
     */
    consumers: ConsumerRegistry
  }>,
) {
  const logger = getLogger()

  return async (event: ConsumerEvent) => {
    // Pre-existing marginal finding (cognitive 16); the 7.3 sweep only stripped banned log fields.
    // fallow-ignore-next-line complexity
    await trace('outbox.dispatch', async () => {
      const eventId = event.eventId
      const eventType = event.eventType

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
        // deployment (consumer expected but never registered → fail so BullMQ
        // retries; a redeploy fixes it) or a family recorded for audit only
        // (no consumer expected → complete).
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
          'No consumers for audit-only event type — completing',
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
      const waiting: string[] = []
      for (const consumer of consumers) {
        const outcome = await invokeConsumer({ repo, logger, eventId, event, consumer })
        if (outcome.kind === 'failed') {
          failures.push({ consumerName: outcome.consumerName, err: outcome.err })
        } else if (outcome.kind === 'waiting') {
          waiting.push(outcome.consumerName)
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
      // Only waits remain: retry the job promptly, without a failure.
      if (waiting.length > 0) {
        throw new PrerequisiteNotReadyError(
          `${waiting.length} consumer(s) waiting for a prerequisite: ${waiting.join(', ')}`,
        )
      }
    })
  }
}

export function createDispatcherHandler(
  repo: OutboxRepository,
  options: Readonly<{ consumers: ConsumerRegistry }>,
) {
  const dispatch = createEventDispatcher(repo, options)
  return async (job: Job) => {
    // Every producer carries only the durable work ID.
    const data: unknown = job.data
    const workId =
      data && typeof data === 'object' ? (data as { workId?: unknown }).workId : undefined
    if (typeof workId !== 'string' || !workId)
      throw new UnrecoverableError('Invalid outbox work ID')
    const { workItems, readEvent } = repo.delivery
    const scope = await workItems.resolveDispatch(workId)
    if (!scope || scope.kind !== OUTBOX_DELIVERY_KIND)
      throw new UnrecoverableError('Outbox work binding unavailable')
    return workItems.runExclusive(workId, async () => {
      const work = await workItems.claim(
        scope.organizationId,
        workId,
        OUTBOX_DELIVERY_LEASE_MS,
      )
      if (!work?.leaseToken) return
      try {
        const event = await readEvent(work.organizationId, work.subjectId)
        if (event) {
          await dispatch(buildConsumerEvent(event))
          const required = new Set([
            ...durableConsumersFor(event.eventType).map(({ name }) => name),
            ...options.consumers
              .listFor(event.eventType)
              .map(({ consumerName }) => consumerName),
          ])
          for (const name of required) {
            if (!(await repo.hasReceipt(event.id, name)))
              throw new Error('Outbox consumer receipt missing')
          }
        }
        if (
          !(await workItems.renew(
            work.organizationId,
            work.id,
            work.leaseToken,
            OUTBOX_DELIVERY_LEASE_MS,
          ))
        )
          throw new Error('Outbox work lease lost')
        await workItems.complete(work.organizationId, work.id, work.leaseToken)
      } catch (caught) {
        const error = escalateStalePrerequisiteWait(caught, work.attempts)
        await workItems.renew(
          work.organizationId,
          work.id,
          work.leaseToken,
          OUTBOX_DELIVERY_LEASE_MS,
        )
        const [failed] = await workItems.fail(
          work.organizationId,
          work.id,
          work.leaseToken,
          {
            retryAt:
              error instanceof PrerequisiteNotReadyError
                ? repo.delivery.prerequisiteRetryAt(work.attempts)
                : repo.delivery.retryAt(work.attempts),
            terminal: error instanceof UnrecoverableError,
          },
        )
        if (failed?.state === 'quarantined' && !(error instanceof UnrecoverableError)) {
          throw Object.assign(new UnrecoverableError('Outbox delivery quarantined'), {
            cause: error,
          })
        }
        throw error
      }
    })
  }
}
