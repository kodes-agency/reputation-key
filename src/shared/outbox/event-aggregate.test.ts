import { beforeEach, describe, expect, it } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { inboxResponseTargetPolicyChanged } from '#/contexts/inbox/domain/events'
import { userId } from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { toOutboxEvent } from './event-adapter'
import { buildConsumerEvent } from './envelope'

const now = new Date('2026-11-07T12:00:00.000Z')
const portalUpdated: DomainEvent = {
  _tag: 'portal.updated',
  eventId: 'event-1',
  organizationId: organizationId('organization-1'),
  propertyId: propertyId('property-1'),
  portalId: portalId('portal-1'),
  previousPublicationState: 'draft',
  publicationState: 'published',
  sourceAggregateVersion: now.toISOString(),
  occurredAt: now,
  correlationId: null,
}

describe('declared event aggregates', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('stores a Portal update under its Portal even when it also names a Property', () => {
    expect(toOutboxEvent(portalUpdated).sourceAggregateId).toBe('portal-1')
  })

  it('delivers the declared Portal type while preserving a stored aggregate id', () => {
    const row = toOutboxEvent(portalUpdated)
    const envelope = buildConsumerEvent({
      id: portalUpdated.eventId,
      eventType: row.eventType,
      eventVersion: row.eventVersion ?? 1,
      payload: row.payload,
      organizationId: row.organizationId,
      propertyId: row.propertyId ?? null,
      sourceContext: row.sourceContext,
      // Historical rows retain the aggregate id committed by their writer.
      sourceAggregateId: 'persisted-aggregate',
      recordedAt: now,
    })
    expect(envelope.aggregateType).toBe('portal')
    expect(envelope.sourceAggregateId).toBe('persisted-aggregate')
  })

  it.each(['organization', 'property'] as const)(
    'preserves the aggregate for a %s response-target policy change',
    (policyScope) => {
      const fact = inboxResponseTargetPolicyChanged({
        organizationId: organizationId('organization-1'),
        propertyId:
          policyScope === 'property'
            ? propertyId('20000000-0000-4000-8000-000000000002')
            : null,
        targetKind: 'private_feedback_handling',
        policyScope,
        durationMinutes: 60,
        policyVersion: 1,
        userId: userId('user-1'),
        occurredAt: now,
      })
      expect(toOutboxEvent(fact).sourceAggregateId).toBe(fact.propertyId ?? fact.userId)
    },
  )

  it.each([
    [{ inboxItemId: 'item-1' }, 'inbox_item'],
    [{ inboxItemId: 'item-1', reviewId: 'review-1' }, 'review'],
  ])(
    'retains the aggregate type of historical Inbox creation payload %j',
    (payload, type) => {
      const envelope = buildConsumerEvent({
        id: 'event-1',
        eventType: 'inbox.inbox_item.created',
        eventVersion: 1,
        payload,
        organizationId: 'organization-1',
        propertyId: null,
        sourceContext: 'inbox',
        sourceAggregateId: 'stored-aggregate',
        recordedAt: now,
      })
      expect(envelope.aggregateType).toBe(type)
      expect(envelope.sourceAggregateId).toBe('stored-aggregate')
    },
  )
})
