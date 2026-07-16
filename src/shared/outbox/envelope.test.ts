// BQR-2.1 — ConsumerEvent envelope contract between relay and dispatcher.

import { describe, it, expect } from 'vitest'
import { buildConsumerEvent, parseConsumerEvent } from './envelope'
import type { UnpublishedEvent } from './infrastructure/outbox-repository'

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
}

describe('buildConsumerEvent', () => {
  it('maps unpublished row + validated payload into a full ConsumerEvent', () => {
    const validated = { reviewId: 'rev-1', organizationId: 'org-1', propertyId: 'prop-1' }
    const envelope = buildConsumerEvent(unpublished, validated)

    expect(envelope).toEqual({
      eventId: 'evt-uuid-001',
      eventType: 'review.created',
      eventVersion: 1,
      payload: validated,
      organizationId: 'org-1',
      propertyId: 'prop-1',
      sourceContext: 'review',
      sourceAggregateId: 'rev-1',
    })
  })

  it('preserves null propertyId', () => {
    const envelope = buildConsumerEvent(
      { ...unpublished, propertyId: null },
      { ok: true },
    )
    expect(envelope.propertyId).toBeNull()
  })
})

describe('parseConsumerEvent', () => {
  it('accepts a full envelope produced by buildConsumerEvent', () => {
    const built = buildConsumerEvent(unpublished, unpublished.payload)
    const parsed = parseConsumerEvent(built)
    expect(parsed).toEqual(built)
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
    const built = buildConsumerEvent(unpublished, unpublished.payload)
    const { eventType: _drop, ...rest } = built
    expect(parseConsumerEvent(rest)).toBeNull()
  })

  it('rejects empty eventId', () => {
    const built = buildConsumerEvent(unpublished, unpublished.payload)
    expect(parseConsumerEvent({ ...built, eventId: '' })).toBeNull()
  })

  it('rejects non-integer eventVersion', () => {
    const built = buildConsumerEvent(unpublished, unpublished.payload)
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
    const built = buildConsumerEvent(unpublished, unpublished.payload)
    expect(parseConsumerEvent({ ...built, propertyId: 42 })).toBeNull()
  })
})
