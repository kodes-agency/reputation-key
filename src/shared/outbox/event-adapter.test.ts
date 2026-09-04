// BQR-2.5 — allowlist validation at outbox insert.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractAggregateId,
  OutboxPayloadError,
  toOutboxEvent,
  tryToOutboxEvent,
  withEnvelopeIdentifiers,
} from './event-adapter'
import {
  clearEventSchemas,
  isEventRegistered,
  registerEventSchema,
  validateEventPayload,
} from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { reviewReplyPublicationRequested } from '#/contexts/review/domain/events'
import { inboxBulkAssignmentCompleted } from '#/contexts/inbox/domain/events'
import { goalMonthlyResultClosed } from '#/contexts/goal/domain/events'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import { z, ZodError } from 'zod/v4'
import type { DomainEvent } from '#/shared/events/events'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  portalGroupId,
  portalId,
  portalLinkId,
  propertyId,
  ratingId,
  replyId,
  reviewId,
  scanEventId,
  userId,
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

  it('stores only allowlisted fields plus identifier-only envelope metadata', () => {
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

  it('re-attaches causation and command identifiers after schema validation', () => {
    const event = {
      ...makeReviewCreated(),
      causationId: 'cause-123',
      commandId: 'command-123',
    } as unknown as DomainEvent
    const row = toOutboxEvent(event)

    expect(row.payload).toMatchObject({
      correlationId: null,
      causationId: 'cause-123',
      commandId: 'command-123',
    })
  })

  it('keeps fact-authored identifiers ahead of ambient context', () => {
    const event = {
      ...makeReviewCreated(),
      causationId: 'explicit-cause',
      commandId: 'explicit-command',
    } as unknown as DomainEvent

    expect(
      withEnvelopeIdentifiers(event, {
        causationId: 'ambient-cause',
        commandId: 'ambient-command',
      }),
    ).toMatchObject({
      causationId: 'explicit-cause',
      commandId: 'explicit-command',
    })
  })

  it.each([
    ['reviewId', 'review'],
    ['runId', 'run'],
    ['replyId', 'reply'],
    ['inboxItemId', 'inbox_item'],
    ['monthlyResultId', 'monthly_result'],
    ['noteId', 'note'],
    ['scheduleId', 'schedule'],
    ['uploadId', 'upload'],
    ['propertyId', 'property'],
    ['portalId', 'portal'],
    ['portalGroupId', 'portal_group'],
    ['portalLinkId', 'portal_link'],
    ['portalLinkCategoryId', 'portal_link_category'],
    ['teamId', 'team'],
    ['staffId', 'staff'],
    ['goalId', 'goal'],
    ['invitationId', 'invitation'],
    ['importJobId', 'import_job'],
    ['connectionId', 'connection'],
    ['scanId', 'scan'],
    ['ratingId', 'rating'],
    ['feedbackId', 'feedback'],
    ['linkId', 'link'],
    ['userId', 'user'],
    ['memberUserId', 'member_user'],
    ['closureLineageId', 'closure_lineage'],
  ] as const)('derives aggregate type %s as %s', (field, type) => {
    const id = `${type}-1`
    expect(extractAggregateId({ eventId: 'evt-fallback', [field]: id })).toEqual({
      id,
      type,
    })
  })

  it('uses the explicit event aggregate sentinel when no candidate field matches', () => {
    expect(
      extractAggregateId({ eventId: 'evt-fallback', resourceId: 'resource-1' }),
    ).toEqual({
      id: 'evt-fallback',
      type: 'event',
    })
  })

  it('persists connected events only as canonical identifier-only v3', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const row = toOutboxEvent({
      _tag: 'integration.google_account.connected',
      eventId: 'evt-connected',
      connectionId: 'connection-1',
      organizationId: organizationId('org-1'),
      userId: 'user-1',
      occurredAt: NOW,
      correlationId: null,
    } as DomainEvent)

    expect(row.eventVersion).toBe(3)
    expect(row.payload).toHaveProperty('userId', 'user-1')
    expect(row.payload).not.toHaveProperty('connectedBy')
    expect(row.payload).not.toHaveProperty('outboxEventVersion')
    expect(
      validateEventPayload('integration.google_account.connected', 2, {
        connectionId: 'connection-legacy',
        organizationId: 'organization-legacy',
        connectedBy: 'user-legacy',
      }),
    ).toEqual({
      connectionId: 'connection-legacy',
      organizationId: 'organization-legacy',
      connectedBy: 'user-legacy',
    })
  })

  it('keeps publication intent adapter, schemas, and catalogue on strict v2', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const event = reviewReplyPublicationRequested({
      replyId: replyId('33333333-3333-4333-8333-333333333333'),
      reviewId: reviewId('11111111-1111-4111-8111-111111111111'),
      organizationId: organizationId('organization-1'),
      propertyId: propertyId('22222222-2222-4222-8222-222222222222'),
      userId: userId('user-1'),
      publicationCycle: 1,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      baseObservationRevision: 0,
      occurredAt: NOW,
    })

    const row = toOutboxEvent(event)
    const catalogue = EVENT_FAMILY_ROWS.find(
      (entry) => entry.eventType === 'review.reply.publication_requested',
    )

    expect(row).toMatchObject({
      eventType: 'review.reply.publication_requested',
      eventVersion: 2,
      payload: {
        replyId: '33333333-3333-4333-8333-333333333333',
        reviewId: '11111111-1111-4111-8111-111111111111',
        organizationId: 'organization-1',
        propertyId: '22222222-2222-4222-8222-222222222222',
        userId: 'user-1',
        publicationCycle: 1,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        occurredAt: NOW.toISOString(),
      },
    })
    expect(catalogue).toBeDefined()
    if (!catalogue) throw new Error('publication intent catalogue row is missing')
    expect(catalogue.version).toBe(row.eventVersion)
    expect(isEventRegistered(event._tag, 1)).toBe(true)
    expect(isEventRegistered(event._tag, catalogue.version)).toBe(true)
  })

  it.each([
    ['non-UUID Reply', { replyId: 'reply-1' }],
    ['non-UUID Review', { reviewId: 'review-1' }],
    ['non-UUID Property', { propertyId: 'property-1' }],
    ['empty Organization', { organizationId: ' ' }],
    ['empty authorizing user', { userId: '' }],
    ['invalid occurrence timestamp', { occurredAt: 'not-a-timestamp' }],
  ])(
    'rejects malformed publication intent at the outbox adapter: %s',
    (_name, override) => {
      clearEventSchemas()
      registerAllEventSchemas()
      const malformed = {
        _tag: 'review.reply.publication_requested',
        eventId: '44444444-4444-4444-8444-444444444444',
        replyId: '33333333-3333-4333-8333-333333333333',
        reviewId: '11111111-1111-4111-8111-111111111111',
        organizationId: 'organization-1',
        propertyId: '22222222-2222-4222-8222-222222222222',
        userId: 'user-1',
        publicationCycle: 1,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        occurredAt: NOW,
        correlationId: null,
        ...override,
      } as unknown as DomainEvent

      expect(() => toOutboxEvent(malformed)).toThrow(OutboxPayloadError)
    },
  )

  it('retains the allowlisted Portal Health reason while stripping arbitrary reasons', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const row = toOutboxEvent({
      _tag: 'portal.health.changed',
      eventId: '77777777-7777-4777-8777-777777777777',
      correlationId: null,
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      previousStatus: 'healthy',
      previousReason: 'operational',
      status: 'degraded',
      reason: 'google_destination_unavailable',
      sourceVersion: 'source-event-1:portal-revision-2',
      occurredAt: NOW,
    } as DomainEvent)

    expect(row.eventVersion).toBe(1)
    expect(row.payload).toMatchObject({
      portalId: 'portal-1',
      previousStatus: 'healthy',
      previousReason: 'operational',
      status: 'degraded',
      reason: 'google_destination_unavailable',
      sourceVersion: 'source-event-1:portal-revision-2',
      occurredAt: NOW.toISOString(),
    })
  })

  it.each([
    {
      tag: 'portal.responsibility_became_needed' as const,
      aggregate: { portalId: portalId('portal-1') },
    },
    {
      tag: 'portal_group.deleted' as const,
      aggregate: { portalGroupId: portalGroupId('group-1') },
    },
  ])(
    'emits strict $tag facts as v2 while retaining legacy v1 replay',
    ({ tag, aggregate }) => {
      clearEventSchemas()
      registerAllEventSchemas()
      const common = {
        ...aggregate,
        _tag: tag,
        eventId: `evt-${tag}`,
        organizationId: organizationId('org-1'),
        propertyId: propertyId('prop-1'),
        sourceAggregateVersion: '2025-06-01T12:01:00.000Z',
        occurredAt: NOW,
        correlationId: null,
      } as DomainEvent

      const row = toOutboxEvent(common)
      const payload = row.payload as Record<string, unknown>
      expect(row.eventVersion).toBe(2)
      expect(payload).toMatchObject({
        sourceAggregateVersion: '2025-06-01T12:01:00.000Z',
        occurredAt: NOW.toISOString(),
      })
      expect(() =>
        validateEventPayload(tag, 2, {
          ...payload,
          sourceAggregateVersion: undefined,
        }),
      ).toThrowError(ZodError)
      const legacyPayload =
        tag === 'portal_group.deleted'
          ? { ...payload, sourceAggregateVersion: undefined, occurredAt: undefined }
          : { ...payload, sourceAggregateVersion: undefined }
      const replayed = validateEventPayload(tag, 1, legacyPayload)
      if (tag === 'portal_group.deleted') {
        expect(replayed).not.toHaveProperty('occurredAt')
      } else {
        expect(replayed).toMatchObject({ occurredAt: NOW.toISOString() })
      }
    },
  )

  it('starts responsible-manager update facts at strict v2', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const row = toOutboxEvent({
      _tag: 'portal.responsible_managers.updated',
      eventId: 'evt-responsible-managers-updated',
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      assignmentCount: 1,
      sourceAggregateVersion: '2025-06-01T12:01:00.000Z',
      occurredAt: NOW,
      correlationId: null,
    } as DomainEvent)

    expect(row.eventVersion).toBe(2)
    expect(row.payload).toMatchObject({
      assignmentCount: 1,
      sourceAggregateVersion: '2025-06-01T12:01:00.000Z',
      occurredAt: NOW.toISOString(),
    })
    expect(() =>
      validateEventPayload('portal.responsible_managers.updated', 1, row.payload),
    ).toThrow(/Unknown event type/)
  })

  it.each([
    'portal.content_review.completed',
    'portal.configuration_completeness.recorded',
    'portal.approved_destination_ratio.recorded',
  ] as const)('emits %s as strict v2 while retaining its legacy v1 decoder', (tag) => {
    clearEventSchemas()
    registerAllEventSchemas()
    const event = {
      _tag: tag,
      eventId: `evt-${tag}`,
      correlationId: null,
      reviewId: 'review-1',
      revision: 1,
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      portalGroupId: null,
      supersedesSourceEventId: null,
      completedFields: 4,
      requiredFields: 5,
      approvedDestinations: 3,
      configuredDestinations: 4,
      sourceAggregateVersion: '2025-06-01T12:01:00.000Z',
      occurredAt: NOW,
    } as DomainEvent

    const row = toOutboxEvent(event)
    const payload = row.payload as Record<string, unknown>
    expect(row.eventVersion).toBe(2)
    expect(payload).toMatchObject({
      sourceAggregateVersion: '2025-06-01T12:01:00.000Z',
      occurredAt: NOW.toISOString(),
    })
    expect(() =>
      validateEventPayload(tag, 2, {
        ...payload,
        sourceAggregateVersion: undefined,
      }),
    ).toThrowError(ZodError)
    expect(
      validateEventPayload(tag, 1, {
        ...payload,
        sourceAggregateVersion: undefined,
      }),
    ).toMatchObject({ occurredAt: NOW.toISOString() })
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
        scanSource: 'qr',
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
    expect(rows[0]).toMatchObject({
      eventVersion: 2,
      payload: { scanId: 'scan-1', scanSource: 'qr' },
    })
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

  it('preserves schema-governed nested bulk transitions without content fields', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const event = inboxBulkAssignmentCompleted({
      organizationId: organizationId('org-1'),
      userId: userId('actor-1'),
      bulkId: '6a000000-0000-4000-8000-000000000001',
      transitions: [
        {
          inboxItemId: inboxItemId('6a000000-0000-4000-8000-000000000010'),
          propertyId: propertyId('6a000000-0000-4000-8000-000000000020'),
          previousAssignee: null,
          nextAssignee: userId('manager-1'),
        },
      ],
      occurredAt: NOW,
    })

    expect(toOutboxEvent(event).payload).toMatchObject({
      count: 1,
      transitions: [
        {
          inboxItemId: '6a000000-0000-4000-8000-000000000010',
          propertyId: '6a000000-0000-4000-8000-000000000020',
          previousAssignee: null,
          nextAssignee: 'manager-1',
        },
      ],
    })
  })

  it('adapts a monthly-result close as an identifier-only result aggregate fact', () => {
    clearEventSchemas()
    registerAllEventSchemas()
    const monthlyResultId = '10000000-0000-4000-8000-000000000006'
    const event = goalMonthlyResultClosed({
      organizationId: 'organization-1',
      propertyId: '10000000-0000-4000-8000-000000000002',
      programId: '10000000-0000-4000-8000-000000000003',
      programVersionId: '10000000-0000-4000-8000-000000000004',
      assignmentId: '10000000-0000-4000-8000-000000000005',
      monthlyResultId,
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      evaluationState: 'eligible',
      achieved: true,
      occurredAt: NOW,
    })

    const row = toOutboxEvent(event)
    expect(row).toMatchObject({
      eventType: 'goal.monthly_result.closed',
      eventVersion: 1,
      organizationId: 'organization-1',
      propertyId: '10000000-0000-4000-8000-000000000002',
      sourceContext: 'goal',
      sourceAggregateId: monthlyResultId,
      payload: {
        organizationId: 'organization-1',
        propertyId: '10000000-0000-4000-8000-000000000002',
        programId: '10000000-0000-4000-8000-000000000003',
        programVersionId: '10000000-0000-4000-8000-000000000004',
        assignmentId: '10000000-0000-4000-8000-000000000005',
        monthlyResultId,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z',
        status: 'closed',
        evaluationState: 'eligible',
        achieved: true,
        occurredAt: NOW.toISOString(),
        correlationId: null,
      },
    })
    expect(JSON.stringify(row.payload)).not.toMatch(/programName|subject|description/)
  })
})
