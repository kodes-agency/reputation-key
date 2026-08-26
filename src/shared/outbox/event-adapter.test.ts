// BQR-2.5 — allowlist validation at outbox insert.

import { describe, it, expect, beforeEach } from 'vitest'
import { toOutboxEvent, tryToOutboxEvent, OutboxPayloadError } from './event-adapter'
import {
  clearEventSchemas,
  registerEventSchema,
  validateEventPayload,
} from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { z } from 'zod/v4'
import type { DomainEvent } from '#/shared/events/events'
import {
  feedbackId,
  organizationId,
  portalId,
  portalLinkId,
  propertyId,
  ratingId,
  reviewId,
  scanEventId,
} from '#/shared/domain/ids'

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

  it('supports the invitation v1 sentinel and rejects the retired key from v2', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const base = {
      invitationId: 'invitation-1',
      organizationId: 'org-1',
      role: 'PropertyManager',
    }
    expect(
      validateEventPayload('identity.member.invited', 1, {
        ...base,
        email: '[redacted]',
      }),
    ).toMatchObject({ email: '[redacted]' })
    expect(validateEventPayload('identity.member.invited', 2, base)).toEqual(base)
    expect(() =>
      validateEventPayload('identity.member.invited', 2, {
        ...base,
        email: 'synthetic-secret@example.test',
      }),
    ).toThrow(/expected never/i)
  })

  it('registers the emitted Guest vocabulary with content-minimal payloads', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const common = {
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      occurredAt: NOW,
      correlationId: null,
    }
    const rows = [
      toOutboxEvent({
        _tag: 'guest.scan.recorded',
        eventId: 'evt-scan',
        scanId: scanEventId('scan-1'),
        source: 'qr',
        ...common,
      }),
      toOutboxEvent({
        _tag: 'guest.rating.submitted',
        eventId: 'evt-rating',
        ratingId: ratingId('rating-1'),
        value: 3,
        ...common,
      }),
      toOutboxEvent({
        _tag: 'guest.feedback.submitted',
        eventId: 'evt-feedback',
        feedbackId: feedbackId('feedback-1'),
        ratingId: ratingId('rating-1'),
        ...common,
      }),
      toOutboxEvent({
        _tag: 'guest.review_link.clicked',
        eventId: 'evt-click',
        linkId: portalLinkId('link-1'),
        destinationKind: 'secondary_link',
        ...common,
      }),
    ]

    expect(rows.map((row) => row.eventType)).toEqual([
      'guest.scan.recorded',
      'guest.rating.submitted',
      'guest.feedback.submitted',
      'guest.review_link.clicked',
    ])
    expect(rows[1]!.payload).toMatchObject({ ratingId: 'rating-1', value: 3 })
    expect(rows[3]!.payload).toMatchObject({
      linkId: 'link-1',
      destinationKind: 'secondary_link',
    })
    for (const row of rows) {
      expect(JSON.stringify(row.payload)).not.toMatch(/comment|text|ipHash|sessionId/)
    }
  })

  it('defaults legacy Guest review-link facts to secondary-link semantics', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const row = toOutboxEvent({
      _tag: 'guest.review_link.clicked',
      eventId: 'evt-legacy-click',
      linkId: portalLinkId('link-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      occurredAt: NOW,
      correlationId: null,
    } as DomainEvent)

    expect(row.payload).toMatchObject({
      linkId: 'link-1',
      destinationKind: 'secondary_link',
    })
  })

  it('routes active AI facts through the master allowlist adapter', () => {
    clearEventSchemas()
    registerAllEventSchemas()

    const trend = toOutboxEvent({
      _tag: 'ai.property_trend.generation_requested',
      eventId: '71000000-0000-4000-8000-000000000201',
      scheduleId: '71000000-0000-4000-8000-000000000202',
      organizationId: organizationId('org-1'),
      propertyId: propertyId('71000000-0000-4000-8000-000000000203'),
      occurredAt: NOW,
      correlationId: 'corr-ai-trend',
    })
    const backfill = toOutboxEvent({
      _tag: 'ai.review_analysis.backfill_requested',
      eventId: '71000000-0000-4000-8000-000000000204',
      organizationId: organizationId('org-1'),
      propertyId: propertyId('71000000-0000-4000-8000-000000000203'),
      reviewId: reviewId('71000000-0000-4000-8000-000000000205'),
      sourceEpoch: 2,
      sourceRevision: 3,
      analysisSequence: 4,
      occurredAt: NOW,
      correlationId: 'corr-ai-backfill',
    })

    expect(trend).toMatchObject({
      eventType: 'ai.property_trend.generation_requested',
      sourceContext: 'ai',
      sourceAggregateId: '71000000-0000-4000-8000-000000000202',
      payload: {
        scheduleId: '71000000-0000-4000-8000-000000000202',
        organizationId: 'org-1',
        propertyId: '71000000-0000-4000-8000-000000000203',
        occurredAt: NOW.toISOString(),
        correlationId: 'corr-ai-trend',
      },
    })
    expect(backfill).toMatchObject({
      eventType: 'ai.review_analysis.backfill_requested',
      sourceContext: 'ai',
      sourceAggregateId: '71000000-0000-4000-8000-000000000205',
      payload: {
        reviewId: '71000000-0000-4000-8000-000000000205',
        sourceEpoch: 2,
        sourceRevision: 3,
        analysisSequence: 4,
        occurredAt: NOW.toISOString(),
        correlationId: 'corr-ai-backfill',
      },
    })
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
