// ConsumerEvent envelope — shared contract between outbox relay and dispatcher.
//
// BQR-2.1: The relay must enqueue the full envelope as BullMQ job data.
// Enqueueing only the bare validated payload (legacy bug) left
// event.eventType undefined in the dispatcher, which then discarded every job.
//
// BQC-3.7: the envelope now preserves envelope-grade metadata alongside the
// identifier-only payload: occurred/recorded time, correlation/causation,
// source aggregate version, and processing region — never content.
// Back-compat: parse accepts pre-3.7 8-field envelopes (in-flight jobs from
// before this deploy); build always populates the new fields.
//
// Job name remains eventType; job ID remains the outbox event UUID (dedup).

import type { UnpublishedEvent } from './infrastructure/outbox-repository'

/**
 * Durable job payload delivered on the domain-events queue.
 * Must match what consumers receive from the dispatcher.
 */
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
   * BQC-3.7: outbox row insert time (ISO). Always set by buildConsumerEvent
   * (required going forward); optional in the type so pre-3.7 in-flight
   * envelopes still parse.
   */
  recordedAt?: string
  /** BQC-3.7: trace identifier — envelope-grade metadata, never content. */
  correlationId?: string | null
  /** BQC-3.7: causal chain identifier. Null today — no producer sets it. */
  causationId?: string | null
  /**
   * BQC-3.7: source aggregate version for version fencing. Null today — no
   * event family versions its aggregate (see event-job-catalogue ordering).
   */
  sourceAggregateVersion?: string | number | null
  /** BQC-3.7: processing region. Const 'unscoped' — BQC-4 owns re-scoping. */
  region?: 'unscoped'
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Build the BullMQ job data envelope from a claimed outbox row. The payload
 * was allowlist-validated at insert (event-adapter); the dispatcher is the
 * single validation authority at consume time (BQC-3.7 — no relay-side
 * validation).
 */
export function buildConsumerEvent(event: UnpublishedEvent): ConsumerEvent {
  const payload = isRecord(event.payload) ? event.payload : {}
  return {
    eventId: event.id,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    payload: event.payload,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    sourceContext: event.sourceContext,
    sourceAggregateId: event.sourceAggregateId,
    occurredAt: typeof payload.occurredAt === 'string' ? payload.occurredAt : undefined,
    recordedAt: event.recordedAt.toISOString(),
    correlationId:
      typeof payload.correlationId === 'string' ? payload.correlationId : null,
    causationId: typeof payload.causationId === 'string' ? payload.causationId : null,
    sourceAggregateVersion:
      typeof payload.sourceAggregateVersion === 'string' ||
      typeof payload.sourceAggregateVersion === 'number'
        ? payload.sourceAggregateVersion
        : null,
    region: 'unscoped',
  }
}

type OptionalEnvelopeFields = Pick<
  ConsumerEvent,
  | 'occurredAt'
  | 'recordedAt'
  | 'correlationId'
  | 'causationId'
  | 'sourceAggregateVersion'
  | 'region'
>

/**
 * Validate the BQC-3.7 metadata fields when present. Absent fields are the
 * pre-3.7 shape (accepted); present fields must be well-typed.
 */
function parseOptionalFields(
  data: Record<string, unknown>,
): OptionalEnvelopeFields | null {
  const {
    occurredAt,
    recordedAt,
    correlationId,
    causationId,
    sourceAggregateVersion,
    region,
  } = data
  if (occurredAt !== undefined && typeof occurredAt !== 'string') return null
  if (recordedAt !== undefined && typeof recordedAt !== 'string') return null
  if (
    correlationId !== undefined &&
    correlationId !== null &&
    typeof correlationId !== 'string'
  )
    return null
  if (
    causationId !== undefined &&
    causationId !== null &&
    typeof causationId !== 'string'
  )
    return null
  if (
    sourceAggregateVersion !== undefined &&
    sourceAggregateVersion !== null &&
    typeof sourceAggregateVersion !== 'string' &&
    typeof sourceAggregateVersion !== 'number'
  )
    return null
  if (region !== undefined && region !== 'unscoped') return null

  return {
    occurredAt: occurredAt as string | undefined,
    recordedAt: recordedAt as string | undefined,
    correlationId: (correlationId ?? null) as string | null,
    causationId: (causationId ?? null) as string | null,
    sourceAggregateVersion: (sourceAggregateVersion ?? null) as string | number | null,
    region: 'unscoped',
  }
}

type RequiredEnvelopeFields = Pick<
  ConsumerEvent,
  | 'eventId'
  | 'eventType'
  | 'eventVersion'
  | 'payload'
  | 'organizationId'
  | 'propertyId'
  | 'sourceContext'
  | 'sourceAggregateId'
>

/** Validate the pre-3.7 base fields (every historical envelope carries them). */
function parseRequiredFields(
  data: Record<string, unknown>,
): RequiredEnvelopeFields | null {
  const {
    eventId,
    eventType,
    eventVersion,
    payload,
    organizationId,
    propertyId,
    sourceContext,
    sourceAggregateId,
  } = data

  if (typeof eventId !== 'string' || eventId.length === 0) return null
  if (typeof eventType !== 'string' || eventType.length === 0) return null
  if (typeof eventVersion !== 'number' || !Number.isInteger(eventVersion)) return null
  if (!('payload' in data)) return null
  if (typeof organizationId !== 'string') return null
  if (propertyId !== null && typeof propertyId !== 'string') return null
  if (typeof sourceContext !== 'string' || sourceContext.length === 0) return null
  if (typeof sourceAggregateId !== 'string' || sourceAggregateId.length === 0) return null

  return {
    eventId,
    eventType,
    eventVersion,
    payload,
    organizationId,
    propertyId: propertyId as string | null,
    sourceContext,
    sourceAggregateId,
  }
}

/**
 * Parse and structurally validate job data as a ConsumerEvent.
 * Returns null when the shape is not a full envelope (e.g. bare payload).
 * Does not run Zod schema validation — callers use the event schema registry.
 */
export function parseConsumerEvent(data: unknown): ConsumerEvent | null {
  if (!isRecord(data)) return null

  const required = parseRequiredFields(data)
  if (!required) return null

  const optional = parseOptionalFields(data)
  if (!optional) return null

  return { ...required, ...optional }
}
