// EventJobCatalogue — BQC-3.1.
//
// Runtime catalogue for durable event routing and governed BullMQ families,
// derived from the definitions in src/shared/events/consumer-definitions.ts and
// src/shared/jobs/job-definitions.ts. Event rows name the event type and expected
// durable consumers; a consumed family that nothing emits is listed, with its
// reason, in producerless-event-families.ts. Job rows own retry, timeout,
// scheduling, capability, action, and registration policy.
//
// A missing expected consumer fails worker readiness and dispatcher delivery.
// A missing or unknown job family fails readiness or enqueue policy.

import { DURABLE_CONSUMERS, EVENT_TYPES } from '#/shared/events/consumer-definitions'
import { JOB_FAMILY_ROWS, type JobFamilyRow } from '#/shared/jobs/job-definitions'

// ── Types ───────────────────────────────────────────────────────────

/** A durable outbox consumer of an event family, pinned to its registration module. */
export type EventConsumerRef = Readonly<{
  /** Consumer name, e.g. 'inbox.on-review-created'. */
  name: string
  /** Repo-relative file containing the registerConsumer call. */
  module: string
}>

export type EventFamilyRow = Readonly<{
  eventType: string
  consumers: ReadonlyArray<EventConsumerRef>
}>

export type { JobFamilyRow }

// ── Derived rows ────────────────────────────────────────────────────

export const EVENT_FAMILY_ROWS: ReadonlyArray<EventFamilyRow> = EVENT_TYPES.map(
  (eventType) => ({
    eventType,
    consumers: DURABLE_CONSUMERS.filter((consumer) =>
      consumer.on.includes(eventType),
    ).map(({ name, module }) => ({ name, module })),
  }),
)

export { JOB_FAMILY_ROWS }

// ── Derived lookups ─────────────────────────────────────────────────

/**
 * BQC-3.6: durable consumer refs declared for an event type. The dispatcher
 * uses this to tell a misconfigured deployment (catalogue expects a consumer
 * that was never registered → fail + retry) from a family with no consumers
 * (recorded for audit only → complete).
 */
export function durableConsumersFor(eventType: string): ReadonlyArray<EventConsumerRef> {
  return EVENT_FAMILY_ROWS.find((r) => r.eventType === eventType)?.consumers ?? []
}
