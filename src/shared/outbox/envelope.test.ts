// BQR-2.1 / BQC-3.7 / ARC-01 — ConsumerEvent contract between relay and
// dispatcher. Current envelopes carry aggregate, causation, command, timing,
// and classification metadata. Historical 8-field envelopes must still parse
// while in-flight.

import { describe, it, expect } from 'vitest'
import { buildConsumerEvent, parseConsumerEvent } from './envelope'
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

  it('never relays a retained invitee address while the v1 parser is supported', () => {
    const envelope = buildConsumerEvent({
      ...unpublished,
      eventType: 'identity.member.invited',
      eventVersion: 1,
      payload: {
        invitationId: 'invitation-1',
        organizationId: 'org-1',
        role: 'PropertyManager',
        email: 'synthetic-secret@example.test',
      },
    })

    expect(envelope.payload).toMatchObject({ email: '[redacted]' })
    expect(JSON.stringify(envelope)).not.toContain('synthetic-secret@example.test')
  })

  it('removes the compatibility email key from v2 queue envelopes', () => {
    const envelope = buildConsumerEvent({
      ...unpublished,
      eventType: 'identity.member.invited',
      eventVersion: 2,
      payload: {
        invitationId: 'invitation-1',
        organizationId: 'org-1',
        role: 'PropertyManager',
        email: 'synthetic-secret@example.test',
      },
    })

    expect(envelope.payload).not.toHaveProperty('email')
    expect(JSON.stringify(envelope)).not.toContain('synthetic-secret@example.test')
  })
})

describe('parseConsumerEvent', () => {
  it('round-trips aggregate, command, and causation identity', () => {
    const built = buildConsumerEvent({
      ...unpublished,
      payload: {
        reviewId: 'rev-1',
        commandId: 'command-round-trip',
        causationId: 'cause-round-trip',
      },
    })
    const parsed = parseConsumerEvent(built)

    expect(parsed).toEqual(built)
    expect(parsed).toMatchObject({
      aggregateType: 'review',
      commandId: 'command-round-trip',
      causationId: 'cause-round-trip',
    })
  })

  it('accepts a legacy 8-field envelope (pre-3.7 in-flight jobs)', () => {
    const legacy = {
      eventId: 'evt-legacy',
      eventType: 'review.created',
      eventVersion: 1,
      payload: { reviewId: 'rev-1' },
      organizationId: 'org-1',
      propertyId: null,
      sourceContext: 'review',
      sourceAggregateId: 'rev-1',
    }
    const parsed = parseConsumerEvent(legacy)
    expect(parsed).not.toBeNull()
    expect(parsed!.eventId).toBe('evt-legacy')
    expect(parsed!.recordedAt).toBeUndefined()
    expect(parsed!.aggregateType).toBeUndefined()
    expect(parsed!.commandId).toBeUndefined()
    expect(parsed!.correlationId).toBeNull()
    expect(parsed!.commandClassification).toBeUndefined()
    expect(parsed!.contentClassification).toBeUndefined()
  })

  it('rejects mistyped metadata', () => {
    const built = buildConsumerEvent(unpublished)
    expect(parseConsumerEvent({ ...built, recordedAt: 42 })).toBeNull()
    expect(parseConsumerEvent({ ...built, correlationId: 42 })).toBeNull()
    expect(parseConsumerEvent({ ...built, causationId: {} })).toBeNull()
    expect(parseConsumerEvent({ ...built, aggregateType: 42 })).toBeNull()
    expect(parseConsumerEvent({ ...built, commandId: {} })).toBeNull()
    expect(parseConsumerEvent({ ...built, sourceAggregateVersion: {} })).toBeNull()
    expect(parseConsumerEvent({ ...built, occurredAt: 42 })).toBeNull()
    expect(
      parseConsumerEvent({ ...built, commandClassification: 'local_only' }),
    ).toBeNull()
    expect(
      parseConsumerEvent({ ...built, contentClassification: 'raw_content' }),
    ).toBeNull()
  })

  it('accepts explicit null metadata', () => {
    const built = buildConsumerEvent(unpublished)
    const parsed = parseConsumerEvent({
      ...built,
      correlationId: null,
      causationId: null,
      sourceAggregateVersion: null,
    })
    expect(parsed).not.toBeNull()
  })

  it('rejects bare payload (legacy relay bug shape)', () => {
    // Pre-BQR-2.1 relay enqueued only the validated payload — no eventType.
    const barePayload = {
      reviewId: 'rev-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      rating: 5,
    }
    expect(parseConsumerEvent(barePayload)).toBeNull()
  })

  it('rejects missing eventType', () => {
    const built = buildConsumerEvent(unpublished)
    const { eventType: _drop, ...rest } = built
    expect(parseConsumerEvent(rest)).toBeNull()
  })

  it('rejects empty eventId', () => {
    const built = buildConsumerEvent(unpublished)
    expect(parseConsumerEvent({ ...built, eventId: '' })).toBeNull()
  })

  it('rejects non-integer eventVersion', () => {
    const built = buildConsumerEvent(unpublished)
    expect(parseConsumerEvent({ ...built, eventVersion: 1.5 })).toBeNull()
    expect(parseConsumerEvent({ ...built, eventVersion: '1' })).toBeNull()
  })

  it('rejects non-object / array data', () => {
    expect(parseConsumerEvent(null)).toBeNull()
    expect(parseConsumerEvent(undefined)).toBeNull()
    expect(parseConsumerEvent([])).toBeNull()
    expect(parseConsumerEvent('review.created')).toBeNull()
  })

  it('rejects wrong propertyId type', () => {
    const built = buildConsumerEvent(unpublished)
    expect(parseConsumerEvent({ ...built, propertyId: 42 })).toBeNull()
  })
})
