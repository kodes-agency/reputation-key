// ConsumerEvent envelope — shared contract between outbox relay and dispatcher.
//
// BQR-2.1: The relay must enqueue the full envelope as BullMQ job data.
// Enqueueing only the bare validated payload (legacy bug) left
// event.eventType undefined in the dispatcher, which then discarded every job.
//
// BQC-3.7 / ARC-01: the envelope preserves envelope-grade metadata alongside
// the identifier-only payload: occurred/recorded time, aggregate identity,
// correlation/causation/command identity and source aggregate version — never
// content. Back-compat parsing accepts historical 8-field envelopes; build
// always populates the current fields.
//
// Job name remains eventType; job ID remains the outbox event UUID (dedup).

import type { UnpublishedEvent } from './infrastructure/outbox-repository'
import { extractAggregateId, withoutEnvelopeIdentifiers } from './event-adapter'
import { sanitizeIdentityInvitationQueuePayload } from './identity-invitation-fact-contract'

const DURABLE_COMMAND_CLASSIFICATION = 'durable_domain_fact_required' as const
const IDENTIFIER_ONLY_CONTENT_CLASSIFICATION = 'identifier_only' as const

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
  /**
   * ARC-01: derived from the persisted identifier payload at relay time.
   * Always set by buildConsumerEvent; optional only for in-flight envelopes.
   */
  aggregateType?: string
  /**
   * ARC-01: every outbox envelope is the recovery fact for a command whose
   * downstream effects must survive process loss. Local-only commands never
   * enter this transport.
   */
  commandClassification?: typeof DURABLE_COMMAND_CLASSIFICATION
  /**
   * ARC-01 / ADR 0030: durable payloads contain only identifiers and approved
   * content-free facts. Consumers reload governed content through owning
   * context ports.
   */
  contentClassification?: typeof IDENTIFIER_ONLY_CONTENT_CLASSIFICATION
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
  /**
   * ARC-01: identifier of the command at the root of this causal chain.
   * Always set by buildConsumerEvent; optional only for in-flight envelopes.
   */
  commandId?: string
  /**
   * ARC-01: direct cause of this fact. New envelopes always carry a string;
   * null remains accepted only for pre-ARC-01 in-flight envelopes.
   */
  causationId?: string | null
  /**
   * BQC-3.7: source aggregate version for version fencing. Optional only for
   * legacy or unversioned event families.
   */
  sourceAggregateVersion?: string | number | null
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
  const durablePayload = sanitizeIdentityInvitationQueuePayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  )
  const consumerPayload = withoutEnvelopeIdentifiers(durablePayload)
  const { type: aggregateType } = extractAggregateId(payload, event.id)
  // Rows committed before ARC-01 carry neither identifier. Their durable event
  // id is the stable compatibility fallback; new writes supply execution
  // context in the persisted payload.
  const commandId = typeof payload.commandId === 'string' ? payload.commandId : event.id
  const causationId =
    typeof payload.causationId === 'string' ? payload.causationId : commandId
  return {
    eventId: event.id,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    payload: consumerPayload,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    sourceContext: event.sourceContext,
    sourceAggregateId: event.sourceAggregateId,
    aggregateType,
    commandClassification: DURABLE_COMMAND_CLASSIFICATION,
    contentClassification: IDENTIFIER_ONLY_CONTENT_CLASSIFICATION,
    occurredAt: typeof payload.occurredAt === 'string' ? payload.occurredAt : undefined,
    recordedAt: event.recordedAt.toISOString(),
    correlationId:
      typeof payload.correlationId === 'string' ? payload.correlationId : null,
    commandId,
    causationId,
    sourceAggregateVersion:
      typeof payload.sourceAggregateVersion === 'string' ||
      typeof payload.sourceAggregateVersion === 'number'
        ? payload.sourceAggregateVersion
        : null,
  }
}

type EnvelopeMetadataFields = Pick<
  ConsumerEvent,
  | 'aggregateType'
  | 'occurredAt'
  | 'recordedAt'
  | 'correlationId'
  | 'commandId'
  | 'causationId'
  | 'sourceAggregateVersion'
  | 'commandClassification'
  | 'contentClassification'
>

const isAbsentOrString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string'

const isAbsentOrNullableString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string'

const isAbsentOrNullableAggregateVersion = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number'

const isAbsentOrLiteral = (value: unknown, literal: string): boolean =>
  value === undefined || value === literal

/**
 * Validate the BQC-3.7 scalar metadata fields when present. Absent fields are
 * the pre-3.7 shape (accepted); present fields must be well-typed.
 */
function parseEnvelopeMetadata(
  data: Record<string, unknown>,
): EnvelopeMetadataFields | null {
  const {
    aggregateType,
    occurredAt,
    recordedAt,
    correlationId,
    commandId,
    causationId,
    sourceAggregateVersion,
    commandClassification,
    contentClassification,
  } = data
  if (!isAbsentOrString(aggregateType)) return null
  if (!isAbsentOrString(occurredAt)) return null
  if (!isAbsentOrString(recordedAt)) return null
  if (!isAbsentOrNullableString(correlationId)) return null
  if (!isAbsentOrString(commandId)) return null
  if (!isAbsentOrNullableString(causationId)) return null
  if (!isAbsentOrNullableAggregateVersion(sourceAggregateVersion)) return null
  if (!isAbsentOrLiteral(commandClassification, DURABLE_COMMAND_CLASSIFICATION))
    return null
  if (!isAbsentOrLiteral(contentClassification, IDENTIFIER_ONLY_CONTENT_CLASSIFICATION))
    return null

  return {
    aggregateType: aggregateType as string | undefined,
    occurredAt: occurredAt as string | undefined,
    recordedAt: recordedAt as string | undefined,
    correlationId: (correlationId ?? null) as string | null,
    commandId: commandId as string | undefined,
    causationId: (causationId ?? null) as string | null,
    sourceAggregateVersion: (sourceAggregateVersion ?? null) as string | number | null,
    ...(commandClassification !== undefined
      ? { commandClassification: DURABLE_COMMAND_CLASSIFICATION }
      : {}),
    ...(contentClassification !== undefined
      ? { contentClassification: IDENTIFIER_ONLY_CONTENT_CLASSIFICATION }
      : {}),
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

  const metadata = parseEnvelopeMetadata(data)
  if (!metadata) return null

  return { ...required, ...metadata }
}
