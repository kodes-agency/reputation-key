import { describe, expect, it } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { inboxResponseTargetPolicyChanged } from '#/contexts/reputation/domain/inbox-events'
import { userId } from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from './event-adapter'
import { buildConsumerEvent } from './envelope'
import { getEventDescriptor } from '#/shared/events/registry.server'
import { resolveEventAggregate } from '#/shared/events/descriptor'

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
    expect(
      resolveEventAggregate(
        getEventDescriptor(row.eventType, row.eventVersion ?? 1),
        row.payload as object,
        portalUpdated.eventId,
      ).type,
    ).toBe('portal')
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
      expect(
        resolveEventAggregate(
          getEventDescriptor('inbox.inbox_item.created', 1),
          payload,
          'event-1',
        ).type,
      ).toBe(type)
    },
  )
})
