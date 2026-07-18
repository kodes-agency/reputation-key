// BQR-2.1 / BQC-3.7 — ConsumerEvent envelope contract between relay and dispatcher.
// BQC-3.7 adds envelope-grade metadata: occurredAt, recordedAt, correlationId,
// causationId, sourceAggregateVersion, region. Old 8-field envelopes must
// still parse (in-flight back-compat).

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
      recordedAt: RECORDED_AT.toISOString(),
      correlationId: null,
      causationId: null,
      sourceAggregateVersion: null,
      region: 'unscoped',
    })
  })

  it('preserves null propertyId', () => {
    const envelope = buildConsumerEvent({ ...unpublished, propertyId: null })
    expect(envelope.propertyId).toBeNull()
  })

  it('lifts occurredAt/correlationId/causationId/aggregateVersion from the payload', () => {
    const envelope = buildConsumerEvent({
      ...unpublished,
      payload: {
        reviewId: 'rev-1',
        occurredAt: '2026-07-17T09:59:00.000Z',
        correlationId: 'corr-1',
        causationId: 'cause-1',
        sourceAggregateVersion: 7,
      },
    })

    expect(envelope.occurredAt).toBe('2026-07-17T09:59:00.000Z')
    expect(envelope.correlationId).toBe('corr-1')
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
    expect(envelope.region).toBe('unscoped')
  })
})

describe('parseConsumerEvent', () => {
  it('accepts a full envelope produced by buildConsumerEvent', () => {
    const built = buildConsumerEvent(unpublished)
    const parsed = parseConsumerEvent(built)
    expect(parsed).toEqual(built)
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
    expect(parsed!.correlationId).toBeNull()
    expect(parsed!.region).toBe('unscoped')
  })

  it('rejects a malformed region or mistyped metadata', () => {
    const built = buildConsumerEvent(unpublished)
    expect(parseConsumerEvent({ ...built, region: 'eu-west-1' })).toBeNull()
    expect(parseConsumerEvent({ ...built, recordedAt: 42 })).toBeNull()
    expect(parseConsumerEvent({ ...built, correlationId: 42 })).toBeNull()
    expect(parseConsumerEvent({ ...built, causationId: {} })).toBeNull()
    expect(parseConsumerEvent({ ...built, sourceAggregateVersion: {} })).toBeNull()
    expect(parseConsumerEvent({ ...built, occurredAt: 42 })).toBeNull()
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
