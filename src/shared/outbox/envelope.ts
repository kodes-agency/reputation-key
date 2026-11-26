// ConsumerEvent envelope: the in-memory event the dispatcher builds from a
// stored outbox row and hands to consumers. It carries the identifier-only
// payload with occurred/recorded time, correlation and command identity and
// the source aggregate version, never content. Work-ledger rows hold only the
// outbox event id; the dispatcher reloads the row and builds this per delivery.

import type { UnpublishedEvent } from './infrastructure/outbox-repository'
import { withoutEnvelopeIdentifiers } from './event-adapter'

/** What consumers receive from the dispatcher for one outbox event. */
export type ConsumerEvent = Readonly<{
  eventId: string
  eventType: string
  eventVersion: number
  payload: unknown
  organizationId: string
  propertyId: string | null
  sourceContext: string
  sourceAggregateId: string
  /** BQC-3.7: domain-occurrence time (ISO) when the payload carries it. */
  occurredAt?: string
  /**
   * BQC-3.7: outbox row insert time (ISO). Always set by buildConsumerEvent;
   * optional in the type so hand-built test events can omit it.
   */
  recordedAt?: string
  /** BQC-3.7: trace identifier — envelope-grade metadata, never content. */
  correlationId?: string | null
  /**
   * ARC-01: identifier of the command at the root of this causal chain.
   * Always set by buildConsumerEvent; optional in the type so hand-built
   * test events can omit it.
   */
  commandId?: string
  /**
   * BQC-3.7: source aggregate version for version fencing. Null for
   * unversioned event families.
   */
  sourceAggregateVersion?: string | number | null
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Build the consumer event from a stored outbox row. The payload was
 * allowlist-validated at insert (event-adapter); the dispatcher is the single
 * validation authority at consume time.
 */
export function buildConsumerEvent(event: UnpublishedEvent): ConsumerEvent {
  const payload = isRecord(event.payload) ? event.payload : {}
  const consumerPayload = withoutEnvelopeIdentifiers(event.payload)
  // Rows committed before ARC-01 carry neither identifier. Their durable event
  // id is the stable compatibility fallback; new writes supply execution
  // context in the persisted payload.
  const commandId = typeof payload.commandId === 'string' ? payload.commandId : event.id
  return {
    eventId: event.id,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    payload: consumerPayload,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    sourceContext: event.sourceContext,
    sourceAggregateId: event.sourceAggregateId,
    occurredAt: typeof payload.occurredAt === 'string' ? payload.occurredAt : undefined,
    recordedAt: event.recordedAt.toISOString(),
    correlationId:
      typeof payload.correlationId === 'string' ? payload.correlationId : null,
    commandId,
    sourceAggregateVersion:
      typeof payload.sourceAggregateVersion === 'string' ||
      typeof payload.sourceAggregateVersion === 'number'
        ? payload.sourceAggregateVersion
        : null,
  }
}
