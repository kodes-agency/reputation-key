// BQR-2.1 / BQC-3.7 / ARC-01 — ConsumerEvent contract between relay and
// dispatcher. Envelopes carry aggregate, causation, command, timing, and
// classification metadata.

import { describe, it, expect } from 'vitest'
import { buildConsumerEvent } from './envelope'
import type { UnpublishedEvent } from './infrastructure/outbox-repository'

const RECORDED_AT = new Date('2026-07-17T10:00:00.000Z')

const unpublished: UnpublishedEvent = {
  id: 'evt-uuid-001',
  eventType: 'review.created',
  eventVersion: 1,
  payload: {
    reviewId: 'rev-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    rating: 5,
  },
  organizationId: 'org-1',
  propertyId: 'prop-1',
  sourceContext: 'review',
  sourceAggregateId: 'rev-1',
  recordedAt: RECORDED_AT,
}

describe('buildConsumerEvent', () => {
  it('maps the unpublished row into a full ConsumerEvent with 3.7 metadata', () => {
    const envelope = buildConsumerEvent(unpublished)

    expect(envelope).toEqual({
      eventId: 'evt-uuid-001',
      eventType: 'review.created',
      eventVersion: 1,
      payload: unpublished.payload,
      organizationId: 'org-1',
      propertyId: 'prop-1',
      sourceContext: 'review',
      sourceAggregateId: 'rev-1',
      aggregateType: 'review',
      commandClassification: 'durable_domain_fact_required',
      contentClassification: 'identifier_only',
      recordedAt: RECORDED_AT.toISOString(),
      correlationId: null,
      commandId: 'evt-uuid-001',
      causationId: 'evt-uuid-001',
      sourceAggregateVersion: null,
    })
  })

  it('preserves null propertyId', () => {
    const envelope = buildConsumerEvent({ ...unpublished, propertyId: null })
    expect(envelope.propertyId).toBeNull()
  })

  it('lifts identifier, timing, and aggregate-version metadata from the payload', () => {
    const envelope = buildConsumerEvent({
      ...unpublished,
      payload: {
        reviewId: 'rev-1',
        occurredAt: '2026-07-17T09:59:00.000Z',
        correlationId: 'corr-1',
        commandId: 'command-1',
        causationId: 'cause-1',
        sourceAggregateVersion: 7,
      },
    })

    expect(envelope.aggregateType).toBe('review')
    expect(envelope.occurredAt).toBe('2026-07-17T09:59:00.000Z')
    expect(envelope.correlationId).toBe('corr-1')
    expect(envelope.commandId).toBe('command-1')
    expect(envelope.causationId).toBe('cause-1')
    expect(envelope.sourceAggregateVersion).toBe(7)
    expect(envelope.recordedAt).toBe(RECORDED_AT.toISOString())
  })

  it('keeps an explicit payload correlationId of null as null (identifier, not content)', () => {
    const envelope = buildConsumerEvent({
      ...unpublished,
      payload: { reviewId: 'rev-1', correlationId: null },
    })
    expect(envelope.correlationId).toBeNull()
  })

  it('omits occurredAt when the payload carries none', () => {
    const envelope = buildConsumerEvent(unpublished)
    expect(envelope.occurredAt).toBeUndefined()
  })

  it('tolerates a non-record payload (defaults, no throw)', () => {
    const envelope = buildConsumerEvent({ ...unpublished, payload: 'not-a-record' })
    expect(envelope.payload).toBe('not-a-record')
    expect(envelope.correlationId).toBeNull()
    expect(envelope.aggregateType).toBe('event')
    expect(envelope.commandId).toBe('evt-uuid-001')
    expect(envelope.causationId).toBe('evt-uuid-001')
  })

  it('carries aggregate, command and causation identity from the payload', () => {
    const envelope = buildConsumerEvent({
      ...unpublished,
      payload: {
        reviewId: 'rev-1',
        commandId: 'command-round-trip',
        causationId: 'cause-round-trip',
      },
    })

    expect(envelope).toMatchObject({
      aggregateType: 'review',
      commandId: 'command-round-trip',
      causationId: 'cause-round-trip',
    })
  })
})
