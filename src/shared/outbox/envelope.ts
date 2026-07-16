// ConsumerEvent envelope — shared contract between outbox relay and dispatcher.
//
// BQR-2.1: The relay must enqueue the full envelope as BullMQ job data.
// Enqueueing only the bare validated payload (legacy bug) left
// event.eventType undefined in the dispatcher, which then discarded every job.
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
}>

/**
 * Build the BullMQ job data envelope from a claimed outbox row and its
 * schema-registry-validated payload.
 */
export function buildConsumerEvent(
  event: UnpublishedEvent,
  validatedPayload: unknown,
): ConsumerEvent {
  return {
    eventId: event.id,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    payload: validatedPayload,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    sourceContext: event.sourceContext,
    sourceAggregateId: event.sourceAggregateId,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and structurally validate job data as a ConsumerEvent.
 * Returns null when the shape is not a full envelope (e.g. bare payload).
 * Does not run Zod schema validation — callers use the event schema registry.
 */
export function parseConsumerEvent(data: unknown): ConsumerEvent | null {
  if (!isRecord(data)) return null

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
