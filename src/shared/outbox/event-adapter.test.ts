// BQR-2.5 — allowlist validation at outbox insert.

import { describe, it, expect, beforeEach } from 'vitest'
import { toOutboxEvent, tryToOutboxEvent, OutboxPayloadError } from './event-adapter'
import { clearEventSchemas, registerEventSchema } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { z } from 'zod'
import type { DomainEvent } from '#/shared/events/events'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'

const NOW = new Date('2025-06-01T12:00:00.000Z')

function makeReviewCreated(): DomainEvent {
  return {
    _tag: 'review.created',
    eventId: 'evt-1',
    reviewId: reviewId('rev-1'),
    propertyId: propertyId('prop-1'),
    organizationId: organizationId('org-1'),
    platform: 'google',
    sourceEpoch: 2,
    sourceRevision: 3,
    analysisSequence: 4,
    occurredAt: NOW,
    correlationId: null,
  } as DomainEvent
}

describe('toOutboxEvent allowlist (BQR-2.5)', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerEventSchema({
      type: 'review.created',
      version: 1,
      // BQC-1.2: identifier-only — rating is no longer in the schema.
      schema: z.object({
        reviewId: z.string(),
        organizationId: z.string(),
        propertyId: z.string(),
        sourceEpoch: z.number().int(),
        sourceRevision: z.number().int(),
        platform: z.string().optional(),
        occurredAt: z.string().optional(),
      }),
    })
  })

  it('stores only allowlisted fields (no content, no envelope meta)', () => {
    const row = toOutboxEvent(makeReviewCreated())
    expect(row.eventType).toBe('review.created')
    expect(row.payload).toEqual({
      reviewId: 'rev-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      sourceEpoch: 2,
      sourceRevision: 3,
      platform: 'google',
      occurredAt: NOW.toISOString(),
      // BQC-3.7: correlationId is re-attached post-validation as
      // envelope-grade trace metadata (an identifier, not content).
      correlationId: null,
    })
    expect(row.payload).not.toHaveProperty('rating')
    expect(row.payload).not.toHaveProperty('reviewerName')
    expect(row.payload).not.toHaveProperty('externalId')
    expect(row.payload).not.toHaveProperty('reviewText')
    expect(row.payload).not.toHaveProperty('_tag')
    expect(row.payload).not.toHaveProperty('eventId')
  })

  it('preserves correlationId through toOutboxEvent (BQC-3.7)', () => {
    const event = { ...makeReviewCreated(), correlationId: 'corr-123' } as DomainEvent
    const row = toOutboxEvent(event)
    expect(row.payload).toHaveProperty('correlationId', 'corr-123')
  })

  it('persists connected events only as identifier-only v2', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const row = toOutboxEvent({
      _tag: 'integration.google_account.connected',
      eventId: 'evt-connected',
      connectionId: 'connection-1',
      organizationId: organizationId('org-1'),
      connectedBy: 'user-1',
      occurredAt: NOW,
      correlationId: null,
    } as DomainEvent)

    expect(row.eventVersion).toBe(2)
    expect(row.payload).toHaveProperty('connectedBy', 'user-1')
    expect(row.payload).not.toHaveProperty('outboxEventVersion')
  })

  it('throws unregistered for unknown event types', () => {
    const event = {
      ...makeReviewCreated(),
      _tag: 'unknown.orphan',
    } as unknown as DomainEvent
    expect(() => toOutboxEvent(event)).toThrow(OutboxPayloadError)
    try {
      toOutboxEvent(event)
    } catch (e) {
      expect(e).toBeInstanceOf(OutboxPayloadError)
      expect((e as OutboxPayloadError).code).toBe('unregistered')
    }
  })

  it('tryToOutboxEvent returns null for unregistered types', () => {
    const event = {
      ...makeReviewCreated(),
      _tag: 'unknown.orphan',
    } as unknown as DomainEvent
    expect(tryToOutboxEvent(event)).toBeNull()
  })

  it('throws invalid_payload when required allowlist field is missing', () => {
    const event = {
      _tag: 'review.created',
      eventId: 'evt-2',
      reviewId: reviewId('rev-2'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      // missing externalId
      occurredAt: NOW,
      correlationId: null,
    } as unknown as DomainEvent

    expect(() => toOutboxEvent(event)).toThrow(OutboxPayloadError)
    try {
      toOutboxEvent(event)
    } catch (e) {
      expect((e as OutboxPayloadError).code).toBe('invalid_payload')
    }
  })

  it('rejects content-only smuggling via unregistered field names not in schema', () => {
    // Even if denylist missed a field named "comment", Zod allowlist drops it.
    registerEventSchema({
      type: 'test.smuggle',
      version: 1,
      schema: z.object({
        resourceId: z.string(),
      }),
    })
    const event = {
      _tag: 'test.smuggle',
      eventId: 'evt-3',
      resourceId: 'r-1',
      comment: 'SHOULD NOT PERSIST',
      organizationId: organizationId('org-1'),
    } as unknown as DomainEvent

    const row = toOutboxEvent(event)
    expect(row.payload).toEqual({ resourceId: 'r-1', correlationId: null })
    expect(row.payload).not.toHaveProperty('comment')
  })

  it('normalizes a portal rotation grace deadline before allowlist validation', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const gracePeriodEnds = new Date('2025-06-01T12:05:00.000Z')
    const row = toOutboxEvent({
      _tag: 'portal.token.rotated',
      eventId: 'evt-rotation',
      portalId: 'portal-1',
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      previousVersion: 1,
      version: 2,
      gracePeriodEnds,
      occurredAt: NOW,
      correlationId: null,
    } as DomainEvent)

    expect(row.payload).toMatchObject({
      gracePeriodEnds: gracePeriodEnds.toISOString(),
    })
  })
})
